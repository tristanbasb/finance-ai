import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { seedDefaults } from "@/lib/db/seed";
import { news, newsSymbols } from "@/lib/db/schema";
import { newsQuery, parseYahooNews } from "@/lib/news/yahoo";
import { purgeNews, saveNews } from "@/lib/news/store";
import type { NewsItem } from "@/lib/news/yahoo";

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
