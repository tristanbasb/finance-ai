import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { seedDefaults } from "@/lib/db/seed";
import { accounts, holdings, news, newsSymbols } from "@/lib/db/schema";
import { newsQuery, parseYahooNews } from "@/lib/news/yahoo";
import { lastNewsFetch, listNews, newsCounts, purgeNews, saveNews } from "@/lib/news/store";
import type { NewsItem } from "@/lib/news/yahoo";
import { translatePendingTitles } from "@/lib/news/translate";
import { fetchNews, isNewsHour, translateNews, type NewsDeps } from "@/lib/news";
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
    expect(newsQuery("X", "crypto")).toBe("X-USD");
    expect(newsQuery("ABCDEF", "crypto")).toBe("ABCDEF-USD");
  });
  it("met en majuscules et suffixe les symboles crypto de 3 caractères au plus", () => {
    expect(newsQuery("btc", "crypto")).toBe("BTC-USD");
    expect(newsQuery("eth", "crypto")).toBe("ETH-USD");
  });
  it("laisse intacts les identifiants crypto non standard (noms, plus de 6 caractères)", () => {
    expect(newsQuery("bitcoin", "crypto")).toBe("bitcoin");
    expect(newsQuery("solana", "crypto")).toBe("solana");
    expect(newsQuery("ABCDEFG", "crypto")).toBe("ABCDEFG");
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

  it("ignore les articles plus vieux que la durée de conservation", () => {
    const db = freshDb();
    const now = 100 * 86_400_000;
    const items = [
      item({ uuid: "old", publishedAt: now - 31 * 86_400_000 }),
      item({ uuid: "new", publishedAt: now - 29 * 86_400_000 }),
    ];
    expect(saveNews(db, "AAPL", items, new Set(["AAPL"]), now)).toBe(1);
    expect(db.select().from(news).all().map((r) => r.uuid)).toEqual(["new"]);
    expect(db.select().from(newsSymbols).all()).toHaveLength(1);
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

describe("fetchNews", () => {
  it("un symbole en échec n'empêche pas les autres ; archivés et doublons écartés ; aucune traduction", async () => {
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
    const { ai, parse } = mockAi({ items: [] });
    const deps: NewsDeps = { fetch, ai: () => ai };
    expect(await fetchNews(db, deps, new Date(NOW))).toBe(2);
    expect(fetch.mock.calls.map((c) => c[0]).sort()).toEqual(["AAPL", "BTC-USD", "MSFT"]);
    expect(db.select().from(news).all()).toHaveLength(2);
    expect(parse).not.toHaveBeenCalled();
  });

  it("interroge Yahoo 4 symboles à la fois au plus", async () => {
    const db = freshDb();
    const acc = db.select().from(accounts).get()!;
    for (const s of ["A", "B", "C", "D", "E", "F"])
      db.insert(holdings).values({ accountId: acc.id, symbol: s, name: s, assetType: "stock", quantity: 1, avgPrice: 1 }).run();
    let running = 0;
    let peak = 0;
    const fetch = vi.fn(async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return [];
    });
    await fetchNews(db, { fetch, ai: () => null }, new Date(NOW));
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(peak).toBe(4);
  });

  it("ne lève jamais, même si la base échoue", async () => {
    const deps: NewsDeps = { fetch: async () => [], ai: () => null };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(fetchNews({} as never, deps, new Date(NOW))).resolves.toBe(0);
  });
});

describe("translateNews", () => {
  it("traduit les titres en attente", async () => {
    const db = freshDb();
    saveNews(db, "AAPL", [item({ uuid: "a", publishedAt: NOW - 1000 })], new Set(["AAPL"]), NOW);
    const id = db.select().from(news).get()!.id;
    const { ai } = mockAi({ items: [{ id, title_fr: "Titre" }] });
    expect(await translateNews(db, { fetch: async () => [], ai: () => ai }, new Date(NOW))).toBe(1);
  });

  it("passe un délai de 60 s et une seule reprise à l'API", async () => {
    const db = freshDb();
    saveNews(db, "AAPL", [item({ uuid: "a", publishedAt: NOW - 1000 })], new Set(["AAPL"]), NOW);
    const { ai, parse } = mockAi({ items: [] });
    await translatePendingTitles(db, ai, NOW);
    const opts = (parse.mock.calls[0] as unknown as [unknown, { signal: AbortSignal; maxRetries: number }])[1];
    expect(opts.maxRetries).toBe(1);
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it("ne lève jamais, même si l'IA ou la base échoue", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const deps: NewsDeps = { fetch: async () => [], ai: () => { throw new Error("config"); } };
    await expect(translateNews(freshDb(), deps, new Date(NOW))).resolves.toBe(0);
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

describe("listNews / newsCounts / lastNewsFetch", () => {
  function setup() {
    const db = freshDb();
    const acc = db.select().from(accounts).get()!;
    const archived = db.insert(accounts).values({ name: "Vieux", type: "investment", archived: true }).returning().get();
    const h = (accountId: number, symbol: string, name: string, assetType: "stock" | "crypto" | "manual") =>
      db.insert(holdings).values({ accountId, symbol, name, assetType, quantity: 1, avgPrice: 1 }).returning().get();
    h(acc.id, "aapl", "Apple", "stock");
    h(acc.id, "BTC", "Bitcoin", "crypto");
    h(acc.id, "MAISON", "Maison", "manual");
    h(archived.id, "OLD", "Ancienne", "stock");
    const sold = h(acc.id, "GONE", "Vendue", "stock");
    const add = (uuid: string, symbols: string[], publishedAt: number, fetchedAt = 50) => {
      const row = db
        .insert(news)
        .values({ uuid, title: `T ${uuid}`, publisher: "Reuters", link: `https://example.com/${uuid}`, publishedAt, fetchedAt })
        .returning()
        .get();
      for (const s of symbols) db.insert(newsSymbols).values({ newsId: row.id, symbol: s }).run();
      return row.id;
    };
    return { db, add, sold };
  }

  it("ne renvoie que les symboles des positions actives, du plus récent au plus ancien", () => {
    const { db, add, sold } = setup();
    add("a", ["AAPL"], 300);
    add("b", ["BTC", "OLD"], 200);
    add("c", ["OLD"], 400);
    add("d", ["GONE"], 500);
    db.delete(holdings).where(eq(holdings.id, sold.id)).run();
    const rows = listNews(db, { limit: 10 });
    expect(rows.map((r) => r.title)).toEqual(["T a", "T b"]);
    expect(rows[1].symbols).toEqual(["BTC"]);
    expect(rows[0]).toMatchObject({
      titleFr: null,
      publisher: "Reuters",
      link: "https://example.com/a",
      publishedAt: 300,
      symbols: ["AAPL"],
    });
  });

  it("filtre par symbole (casse indifférente) et ignore un symbole non détenu", () => {
    const { db, add } = setup();
    add("a", ["AAPL"], 300);
    add("b", ["BTC"], 200);
    add("c", ["OLD"], 400);
    expect(listNews(db, { symbol: "btc", limit: 10 }).map((r) => r.title)).toEqual(["T b"]);
    expect(listNews(db, { symbol: "OLD", limit: 10 })).toEqual([]);
  });

  it("pagine avec before (strict) et beforeId pour départager les dates égales", () => {
    const { db, add } = setup();
    const ids = [add("a", ["AAPL"], 300), add("b", ["AAPL"], 200), add("c", ["AAPL"], 200), add("d", ["AAPL"], 100)];
    const first = listNews(db, { limit: 2 });
    expect(first.map((r) => r.title)).toEqual(["T a", "T c"]);
    const next = listNews(db, { limit: 2, before: first[1].publishedAt, beforeId: first[1].id });
    expect(next.map((r) => r.title)).toEqual(["T b", "T d"]);
    expect(listNews(db, { limit: 10, before: 200 }).map((r) => r.id)).toEqual([ids[3]]);
  });

  it("compte les articles récents par position active, zéro compris", () => {
    const { db, add } = setup();
    add("a", ["AAPL"], 300);
    add("b", ["AAPL", "BTC"], 250);
    add("c", ["AAPL"], 10);
    add("d", ["OLD"], 400);
    expect(newsCounts(db, 100)).toEqual([
      { symbol: "AAPL", name: "Apple", count: 2 },
      { symbol: "BTC", name: "Bitcoin", count: 1 },
      { symbol: "GONE", name: "Vendue", count: 0 },
    ]);
    expect(newsCounts(db, 1000)).toEqual([
      { symbol: "AAPL", name: "Apple", count: 0 },
      { symbol: "BTC", name: "Bitcoin", count: 0 },
      { symbol: "GONE", name: "Vendue", count: 0 },
    ]);
    expect(newsCounts(freshDb(), 0)).toEqual([]);
  });

  it("donne la date de la dernière récupération, ou null", () => {
    const { db, add } = setup();
    expect(lastNewsFetch(db)).toBeNull();
    add("a", ["AAPL"], 300, 70);
    add("b", ["OLD"], 300, 90);
    expect(lastNewsFetch(db)).toBe(90);
  });
});
