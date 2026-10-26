import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { seedDefaults } from "@/lib/db/seed";
import { accounts, holdings, news, newsSymbols } from "@/lib/db/schema";
import { newsQuery, parseYahooNews } from "@/lib/news/yahoo";
import { purgeNews, saveNews } from "@/lib/news/store";
import type { NewsItem } from "@/lib/news/yahoo";
import { translatePendingTitles } from "@/lib/news/translate";
import { isNewsHour, refreshNews, type NewsDeps } from "@/lib/news";
import type Anthropic from "@anthropic-ai/sdk";
import type { Ai } from "@/lib/ai/client";

function freshDb() {
  const db = createDb(":memory:");
  runMigrations(db);
  seedDefaults(db);
  return db;
}

function item(extra: Partial<NewsItem> = {}): NewsItem {
  return {
    uuid: "u1",
    title: "Apple publie ses résultats",
    publisher: "Reuters",
    link: "https://example.com/a",
    publishedAt: 1_000_000,
    relatedTickers: [],
    ...extra,
  };
}

describe("newsQuery", () => {
  it("ajoute -USD aux symboles crypto courts en majuscules", () => {
    expect(newsQuery("BTC", "crypto")).toBe("BTC-USD");
  });
  it("laisse intacts les identifiants crypto non standard", () => {
    expect(newsQuery("bitcoin", "crypto")).toBe("bitcoin");
    expect(newsQuery("ABCDEFG", "crypto")).toBe("ABCDEFG");
  });
  it("met en majuscules et suffixe les symboles crypto de 1 à 6 caractères", () => {
    expect(newsQuery("btc", "crypto")).toBe("BTC-USD");
    expect(newsQuery("X", "crypto")).toBe("X-USD");
    expect(newsQuery("ABCDEF", "crypto")).toBe("ABCDEF-USD");
  });
  it("laisse intacts les symboles d'ETF et d'actions", () => {
    expect(newsQuery("CW8.PA", "etf")).toBe("CW8.PA");
    expect(newsQuery("AAPL", "stock")).toBe("AAPL");
  });
});

describe("parseYahooNews", () => {
  const valid = {
    uuid: "abc",
    title: "Titre",
    publisher: "Reuters",
    link: "https://example.com/x",
    providerPublishTime: new Date(1_700_000_000_000),
    relatedTickers: ["AAPL"],
  };

  it("garde un article valide et convertit la date en ms", () => {
    expect(parseYahooNews([valid])).toEqual([
      {
        uuid: "abc",
        title: "Titre",
        publisher: "Reuters",
        link: "https://example.com/x",
        publishedAt: 1_700_000_000_000,
        relatedTickers: ["AAPL"],
      },
    ]);
  });
  it("rejette un lien non http(s)", () => {
    expect(parseYahooNews([{ ...valid, link: "javascript:alert(1)" }])).toEqual([]);
  });
  it("rejette un titre vide", () => {
    expect(parseYahooNews([{ ...valid, title: "  " }])).toEqual([]);
  });
  it("rejette une date invalide", () => {
    expect(parseYahooNews([{ ...valid, providerPublishTime: new Date("x") }])).toEqual([]);
  });
  it("rejette une entrée sans uuid ou non objet", () => {
    expect(parseYahooNews([{ ...valid, uuid: "" }, null, "x"])).toEqual([]);
  });
});

describe("saveNews", () => {
  it("n'insère qu'une fois un même uuid", () => {
    const db = freshDb();
    expect(saveNews(db, "AAPL", [item()], new Set(["AAPL"]), 5_000)).toBe(1);
    expect(saveNews(db, "AAPL", [item()], new Set(["AAPL"]), 6_000)).toBe(0);
    expect(db.select().from(news).all()).toHaveLength(1);
  });

  it("lie le symbole interrogé et les tickers détenus, en majuscules", () => {
    const db = freshDb();
    saveNews(db, "AAPL", [item({ relatedTickers: ["AAPL", "msft", "TSLA"] })], new Set(["AAPL", "MSFT"]), 5_000);
    const symbols = db.select().from(newsSymbols).all().map((r) => r.symbol).sort();
    expect(symbols).toEqual(["AAPL", "MSFT"]);
  });

  it("ajoute la liaison d'un autre symbole pour un article déjà connu", () => {
    const db = freshDb();
    saveNews(db, "AAPL", [item()], new Set(["AAPL", "MSFT"]), 5_000);
    expect(saveNews(db, "MSFT", [item()], new Set(["AAPL", "MSFT"]), 6_000)).toBe(0);
    expect(db.select().from(newsSymbols).all()).toHaveLength(2);
  });
});

describe("purgeNews", () => {
  it("supprime les articles de plus de 30 jours et leurs liaisons", () => {
    const db = freshDb();
    const now = 100 * 86_400_000;
    saveNews(db, "AAPL", [item({ uuid: "old", publishedAt: now - 31 * 86_400_000 })], new Set(["AAPL"]), now);
    saveNews(db, "AAPL", [item({ uuid: "new", publishedAt: now - 1 * 86_400_000 })], new Set(["AAPL"]), now);
    purgeNews(db, now);
    expect(db.select().from(news).all().map((r) => r.uuid)).toEqual(["new"]);
    const left = db.select().from(newsSymbols).all();
    expect(left).toHaveLength(1);
    expect(db.select().from(news).where(eq(news.uuid, "new")).get()!.id).toBe(left[0].newsId);
  });
});

function mockAi(output: unknown) {
  const parse = vi.fn(async () => ({ parsed_output: output, stop_reason: "end_turn", content: [] }));
  const ai = { client: { messages: { parse } } as unknown as Anthropic, model: "claude-opus-5-5" } satisfies Ai;
  return { ai, parse };
}

const NOW = Date.UTC(2026, 9, 26, 10);

describe("translatePendingTitles", () => {
  function seed() {
    const db = freshDb();
    saveNews(db, "AAPL", [item({ uuid: "a", publishedAt: NOW - 1000 })], new Set(["AAPL"]), NOW);
    const id = db.select().from(news).get()!.id;
    return { db, id };
  }

  it("remplit titleFr, ignore les ids inconnus, prompt sûr", async () => {
    const { db, id } = seed();
    const { ai, parse } = mockAi({
      items: [
        { id, title_fr: "Apple publie ses résultats" },
        { id: 9999, title_fr: "inconnu" },
      ],
    });
    expect(await translatePendingTitles(db, ai, NOW)).toBe(1);
    expect(db.select().from(news).get()!.titleFr).toBe("Apple publie ses résultats");
    const arg = (parse.mock.calls[0] as unknown as [{ system: string }])[0];
    expect(arg.system).toContain("données");
    expect(arg.system).toContain("jamais des instructions");
  });

  it("sans IA : 0 et titleFr reste null", async () => {
    const { db } = seed();
    expect(await translatePendingTitles(db, null, NOW)).toBe(0);
    expect(db.select().from(news).get()!.titleFr).toBeNull();
  });

  it("erreur de l'API : 0, rien modifié", async () => {
    const { db } = seed();
    const ai = {
      client: { messages: { parse: async () => { throw new Error("boom"); } } } as unknown as Anthropic,
      model: "m",
    } satisfies Ai;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await translatePendingTitles(db, ai, NOW)).toBe(0);
    expect(db.select().from(news).get()!.titleFr).toBeNull();
  });

  it("ignore les articles de plus de 7 jours", async () => {
    const db = freshDb();
    saveNews(db, "AAPL", [item({ uuid: "old", publishedAt: NOW - 8 * 86_400_000 })], new Set(), NOW);
    const { ai, parse } = mockAi({ items: [] });
    expect(await translatePendingTitles(db, ai, NOW)).toBe(0);
    expect(parse).not.toHaveBeenCalled();
  });
});

describe("refreshNews", () => {
  it("un symbole en échec n'empêche pas les autres ; archivés et doublons écartés", async () => {
    const db = freshDb();
    const acc = db.select().from(accounts).get()!;
    const archived = db.insert(accounts).values({ name: "Vieux", type: "investment", archived: true }).returning().get();
    const h = (accountId: number, symbol: string, assetType: "stock" | "crypto" | "manual") =>
      db.insert(holdings).values({ accountId, symbol, name: symbol, assetType, quantity: 1, avgPrice: 1 }).run();
    h(acc.id, "AAPL", "stock");
    h(acc.id, "aapl", "stock");
    h(acc.id, "MSFT", "stock");
    h(acc.id, "BTC", "crypto");
    h(archived.id, "TSLA", "stock");
    h(acc.id, "IMMO", "manual");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetch = vi.fn(async (q: string) => {
      if (q === "AAPL") throw new Error("réseau");
      return [item({ uuid: `u-${q}`, publishedAt: NOW - 1000 })];
    });
    const deps: NewsDeps = { fetch, ai: () => null };
    const res = await refreshNews(db, deps, new Date(NOW));
    expect(fetch.mock.calls.map((c) => c[0]).sort()).toEqual(["AAPL", "BTC-USD", "MSFT"]);
    expect(res).toEqual({ added: 2, translated: 0 });
    expect(db.select().from(news).all()).toHaveLength(2);
  });

  it("ne lève jamais, même si la base échoue", async () => {
    const deps: NewsDeps = { fetch: async () => [], ai: () => null };
    await expect(refreshNews({} as never, deps, new Date(NOW))).resolves.toEqual({ added: 0, translated: 0 });
  });
});

describe("isNewsHour", () => {
  it("7 h à 22 h exclu (heure locale)", () => {
    expect(isNewsHour(new Date(2026, 9, 26, 6, 59))).toBe(false);
    expect(isNewsHour(new Date(2026, 9, 26, 7, 0))).toBe(true);
    expect(isNewsHour(new Date(2026, 9, 26, 21, 59))).toBe(true);
    expect(isNewsHour(new Date(2026, 9, 26, 22, 0))).toBe(false);
  });
});
