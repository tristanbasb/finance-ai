import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { seedDefaults } from "@/lib/db/seed";
import { accounts, holdings, prices, snapshots } from "@/lib/db/schema";
import { refreshPrices, resolvePrice, type PriceFetcher } from "@/lib/prices";
import { listSnapshots, recordSnapshot } from "@/lib/queries/snapshots";

function freshDb() {
  const db = createDb(":memory:");
  runMigrations(db);
  seedDefaults(db);
  return db;
}
type TestDb = ReturnType<typeof freshDb>;

function addHolding(
  db: TestDb,
  symbol: string,
  assetType: "stock" | "etf" | "crypto" | "manual",
  extra: Partial<typeof holdings.$inferInsert> = {},
) {
  const accountId = db.select().from(accounts).get()!.id;
  return db
    .insert(holdings)
    .values({ accountId, symbol, name: symbol, assetType, quantity: 2, avgPrice: 5_000, ...extra })
    .returning()
    .get();
}

const NOW = new Date("2026-10-24T12:00:00Z");

function fetcher(data: Record<string, { price: number; currency: string }>): PriceFetcher {
  return vi.fn(async (symbols: string[]) => {
    const out = new Map<string, { price: number; currency: string }>();
    for (const s of symbols) if (data[s]) out.set(s, data[s]);
    return out;
  });
}

const eur = async () => 1;
const noFetch: PriceFetcher = async () => new Map();

describe("refreshPrices", () => {
  it("convertit un cours en USD vers l'euro et l'enregistre en centimes", async () => {
    const db = freshDb();
    addHolding(db, "AAPL", "stock");
    const stock = fetcher({ AAPL: { price: 110, currency: "USD" } });
    const res = await refreshPrices(
      db,
      { stock, crypto: noFetch, fx: async (c) => (c === "USD" ? 1.1 : 1) },
      NOW,
    );
    expect(res).toEqual({ updated: 1, failed: [] });
    const row = db.select().from(prices).where(eq(prices.symbol, "AAPL")).get()!;
    expect(row.price).toBeCloseTo(10_000, 6); // 110 / 1.1 = 100 EUR
    expect(row.currency).toBe("EUR");
    expect(row.fetchedAt).toBe(NOW.getTime());
  });

  it("traite GBp (pence) comme GBP / 100", async () => {
    const db = freshDb();
    addHolding(db, "VOD.L", "stock");
    const stock = fetcher({ "VOD.L": { price: 7_500, currency: "GBp" } }); // 75 GBP
    const fx = vi.fn(async (c: string) => (c === "GBP" ? 0.75 : 1)); // 1 EUR = 0.75 GBP
    await refreshPrices(db, { stock, crypto: noFetch, fx }, NOW);
    const row = db.select().from(prices).where(eq(prices.symbol, "VOD.L")).get()!;
    expect(row.price).toBeCloseTo(10_000, 6); // 75 / 0.75 = 100 EUR
    expect(fx).toHaveBeenCalledWith("GBP");
  });

  it("un fetcher qui lève met ses symboles en échec et conserve l'ancien cours", async () => {
    const db = freshDb();
    addHolding(db, "AAPL", "stock");
    addHolding(db, "BTC", "crypto");
    db.insert(prices).values({ symbol: "AAPL", price: 4_200, currency: "EUR", fetchedAt: 1 }).run();
    const stock: PriceFetcher = async () => {
      throw new Error("réseau");
    };
    const crypto = fetcher({ BTC: { price: 60_000, currency: "EUR" } });
    const res = await refreshPrices(db, { stock, crypto, fx: eur }, NOW);
    expect(res).toEqual({ updated: 1, failed: ["AAPL"] });
    expect(db.select().from(prices).where(eq(prices.symbol, "AAPL")).get()!.price).toBe(4_200);
    expect(db.select().from(prices).where(eq(prices.symbol, "BTC")).get()!.price).toBeCloseTo(
      6_000_000,
      6,
    );
  });

  it("un symbole absent du résultat est en échec", async () => {
    const db = freshDb();
    addHolding(db, "AAPL", "stock");
    addHolding(db, "NOPE", "etf");
    const stock = fetcher({ AAPL: { price: 10, currency: "EUR" } });
    const res = await refreshPrices(db, { stock, crypto: noFetch, fx: eur }, NOW);
    expect(res).toEqual({ updated: 1, failed: ["NOPE"] });
  });

  it("un taux de change indisponible met le symbole en échec sans stocker de prix", async () => {
    const db = freshDb();
    addHolding(db, "XYZ", "stock");
    const stock = fetcher({ XYZ: { price: 10, currency: "CHF" } });
    const fx = async () => {
      throw new Error("pas de taux");
    };
    const res = await refreshPrices(db, { stock, crypto: noFetch, fx }, NOW);
    expect(res).toEqual({ updated: 0, failed: ["XYZ"] });
    expect(db.select().from(prices).all()).toHaveLength(0);
  });

  it("ne redemande pas un cours frais (< 15 min) sans force, mais le redemande avec force", async () => {
    const db = freshDb();
    addHolding(db, "AAPL", "stock");
    db.insert(prices)
      .values({
        symbol: "AAPL",
        price: 4_200,
        currency: "EUR",
        fetchedAt: NOW.getTime() - 5 * 60_000,
      })
      .run();
    const stock = fetcher({ AAPL: { price: 50, currency: "EUR" } });
    const first = await refreshPrices(db, { stock, crypto: noFetch, fx: eur }, NOW);
    expect(first).toEqual({ updated: 0, failed: [] });
    expect(stock).not.toHaveBeenCalled();
    const forced = await refreshPrices(db, { stock, crypto: noFetch, fx: eur }, NOW, true);
    expect(forced.updated).toBe(1);
    expect(stock).toHaveBeenCalledTimes(1);
    expect(db.select().from(prices).get()!.price).toBeCloseTo(5_000, 6);
  });

  it("redemande un cours périmé (> 15 min) sans force", async () => {
    const db = freshDb();
    addHolding(db, "AAPL", "stock");
    db.insert(prices)
      .values({
        symbol: "AAPL",
        price: 4_200,
        currency: "EUR",
        fetchedAt: NOW.getTime() - 20 * 60_000,
      })
      .run();
    const stock = fetcher({ AAPL: { price: 50, currency: "EUR" } });
    const res = await refreshPrices(db, { stock, crypto: noFetch, fx: eur }, NOW);
    expect(res.updated).toBe(1);
  });

  it("ne demande jamais les actifs manuels et dédoublonne les symboles", async () => {
    const db = freshDb();
    addHolding(db, "IMMO", "manual", { manualPrice: 100 });
    addHolding(db, "AAPL", "stock");
    addHolding(db, "AAPL", "stock");
    const stock = fetcher({ AAPL: { price: 10, currency: "EUR" } });
    const crypto = fetcher({});
    const res = await refreshPrices(db, { stock, crypto, fx: eur }, NOW);
    expect(res).toEqual({ updated: 1, failed: [] });
    expect(stock).toHaveBeenCalledWith(["AAPL"]);
    expect(crypto).not.toHaveBeenCalled();
  });
});

describe("resolvePrice", () => {
  it("prix manuel pour un actif manuel", () => {
    const db = freshDb();
    const h = addHolding(db, "IMMO", "manual", { manualPrice: 12_345 });
    expect(resolvePrice(db, h)).toEqual({ price: 12_345, source: "manual" });
  });

  it("source 'cost' sans cours en cache", () => {
    const db = freshDb();
    const h = addHolding(db, "AAPL", "stock");
    expect(resolvePrice(db, h)).toEqual({ price: 5_000, source: "cost" });
  });

  it("'live' si le cours date de moins de 15 min, 'cache' sinon", () => {
    const db = freshDb();
    const h = addHolding(db, "AAPL", "stock");
    db.insert(prices)
      .values({ symbol: "AAPL", price: 6_000, currency: "EUR", fetchedAt: NOW.getTime() - 60_000 })
      .run();
    expect(resolvePrice(db, h, NOW)).toEqual({ price: 6_000, source: "live" });
    const later = new Date(NOW.getTime() + 30 * 60_000);
    expect(resolvePrice(db, h, later)).toEqual({ price: 6_000, source: "cache" });
  });
});

describe("snapshots", () => {
  it("recordSnapshot enregistre les totaux et met à jour la même date (upsert)", () => {
    const db = freshDb();
    const acc = db.select().from(accounts).get()!;
    db.update(accounts).set({ initialBalance: 100_000 }).where(eq(accounts.id, acc.id)).run();
    recordSnapshot(db, "2026-10-24");
    expect(listSnapshots(db, 30, new Date("2026-10-24T12:00:00"))).toEqual([
      { date: "2026-10-24", netWorth: 100_000, cash: 100_000, investments: 0 },
    ]);
    db.update(accounts).set({ initialBalance: 150_000 }).where(eq(accounts.id, acc.id)).run();
    recordSnapshot(db, "2026-10-24");
    expect(db.select().from(snapshots).all()).toHaveLength(1);
    expect(listSnapshots(db, 30, new Date("2026-10-24T12:00:00"))[0]).toEqual({
      date: "2026-10-24",
      netWorth: 150_000,
      cash: 150_000,
      investments: 0,
    });
  });

  it("listSnapshots renvoie les `days` derniers jours par date croissante", () => {
    const db = freshDb();
    for (const d of ["2026-10-24", "2026-10-20", "2026-09-01", "2026-10-22"]) {
      db.insert(snapshots).values({ date: d, netWorth: 1, cash: 1, investments: 0 }).run();
    }
    expect(listSnapshots(db, 7, new Date("2026-10-24T12:00:00")).map((s) => s.date)).toEqual([
      "2026-10-20",
      "2026-10-22",
      "2026-10-24",
    ]);
  });
});

describe("refreshPrices — robustesse", () => {
  it("un cours nul est refusé (échec, ancien cours conservé)", async () => {
    const db = freshDb();
    addHolding(db, "AAPL", "stock");
    db.insert(prices).values({ symbol: "AAPL", price: 4_200, currency: "EUR", fetchedAt: 1 }).run();
    const stock = fetcher({ AAPL: { price: 0, currency: "EUR" } });
    const res = await refreshPrices(db, { stock, crypto: noFetch, fx: eur }, NOW);
    expect(res).toEqual({ updated: 0, failed: ["AAPL"] });
    expect(db.select().from(prices).get()!.price).toBe(4_200);
  });

  it("interroge actions et cryptos en parallèle", async () => {
    const db = freshDb();
    addHolding(db, "AAPL", "stock");
    addHolding(db, "BTC", "crypto");
    let cryptoStarted!: () => void;
    const started = new Promise<void>((resolve) => (cryptoStarted = resolve));
    // Le fetcher actions attend que le fetcher crypto ait démarré : en séquentiel, blocage.
    const stock: PriceFetcher = async () => {
      await started;
      return new Map([["AAPL", { price: 10, currency: "EUR" }]]);
    };
    const crypto: PriceFetcher = async () => {
      cryptoStarted();
      return new Map([["BTC", { price: 20, currency: "EUR" }]]);
    };
    const res = await refreshPrices(db, { stock, crypto, fx: eur }, NOW);
    expect(res).toEqual({ updated: 2, failed: [] });
  });
});

describe("coingeckoFetcher", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("un échec de /search pour un symbole n'empêche pas de coter les autres", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url.pathname.endsWith("/search")) {
        const q = url.searchParams.get("query");
        if (q === "FAILX") return new Response("{}", { status: 429 });
        if (q === "OKA") return json({ coins: [{ id: "ok-a", symbol: "oka" }] });
        if (q === "OKB") return json({ coins: [{ id: "ok-b", symbol: "OKB" }] });
        return json({ coins: [] });
      }
      if (url.pathname.endsWith("/simple/price")) {
        expect(url.searchParams.get("ids")).toBe("ok-a,ok-b");
        return json({ "ok-a": { eur: 1.5 }, "ok-b": { eur: 2 } });
      }
      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { coingeckoFetcher } = await import("@/lib/prices/coingecko");
    const out = await coingeckoFetcher(["OKA", "FAILX", "OKB"]);
    expect(Object.fromEntries(out)).toEqual({
      OKA: { price: 1.5, currency: "EUR" },
      OKB: { price: 2, currency: "EUR" },
    });
  });
});

describe("withTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejette après le délai si la promesse ne se résout pas", async () => {
    vi.useFakeTimers();
    const { withTimeout } = await import("@/lib/prices/timeout");
    const pending = withTimeout(() => new Promise<never>(() => {}), 8000, "Yahoo");
    const assertion = expect(pending).rejects.toThrow(/Yahoo.*8 s/);
    await vi.advanceTimersByTimeAsync(8000);
    await assertion;
  });

  it("transmet un signal d'annulation et renvoie le résultat à temps", async () => {
    const { withTimeout } = await import("@/lib/prices/timeout");
    let received: AbortSignal | undefined;
    const value = await withTimeout(async (signal) => {
      received = signal;
      return 42;
    }, 8000, "Yahoo");
    expect(value).toBe(42);
    expect(received).toBeInstanceOf(AbortSignal);
  });
});
