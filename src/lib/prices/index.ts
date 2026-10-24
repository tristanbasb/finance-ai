import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { holdings, prices } from "@/lib/db/schema";
import { unitPrice, type Holding } from "@/lib/queries/holdings";

/** Cours en unités de la devise (pas en centimes), par symbole. */
export type PriceFetcher = (
  symbols: string[],
) => Promise<Map<string, { price: number; currency: string }>>;

export type PriceDeps = {
  stock: PriceFetcher;
  crypto: PriceFetcher;
  /** Nombre d'unités de `cur` pour 1 EUR (ex. USD → 1,1). */
  fx: (cur: string) => Promise<number>;
};

/** Durée de fraîcheur d'un cours en cache. */
export const FRESH_MS = 15 * 60_000;

export type ResolvedPriceSource = "live" | "cache" | "manual" | "cost";

/**
 * Prix unitaire (centimes) d'une position : prix manuel, sinon cours en cache
 * (« live » s'il a moins de 15 min), sinon prix de revient.
 */
export function resolvePrice(
  db: Db,
  h: Pick<Holding, "symbol" | "assetType" | "manualPrice" | "avgPrice">,
  now: Date = new Date(),
): { price: number; source: ResolvedPriceSource } {
  const row = db.select().from(prices).where(eq(prices.symbol, h.symbol)).get();
  const { price, source } = unitPrice(h, row?.price ?? null);
  if (source === "cache" && row) {
    return { price, source: now.getTime() - row.fetchedAt < FRESH_MS ? "live" : "cache" };
  }
  return { price, source };
}

/** Convertit un cours en unités de `currency` en centimes d'euro. */
async function toEuroCents(
  value: number,
  currency: string,
  fx: (cur: string) => Promise<number>,
): Promise<number> {
  let amount = value;
  let cur = currency.trim();
  if (cur === "GBp" || cur === "GBX") {
    amount = value / 100;
    cur = "GBP";
  }
  cur = cur.toUpperCase();
  if (cur === "EUR") return amount * 100;
  const rate = await fx(cur);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error(`Taux de change invalide pour ${cur}`);
  return (amount / rate) * 100;
}

/**
 * Actualise les cours des positions stock/etf/crypto (jamais « manual »).
 * Les cours de moins de 15 min sont ignorés sauf `force`. Un échec (fetcher, symbole
 * absent, change indisponible) place le symbole dans `failed` et conserve l'ancien cours.
 */
export async function refreshPrices(
  db: Db,
  deps: PriceDeps,
  now: Date,
  force = false,
): Promise<{ updated: number; failed: string[] }> {
  const rows = db.select().from(holdings).all();
  const stockSymbols = new Set<string>();
  const cryptoSymbols = new Set<string>();
  for (const h of rows) {
    if (h.assetType === "stock" || h.assetType === "etf") stockSymbols.add(h.symbol);
    else if (h.assetType === "crypto") cryptoSymbols.add(h.symbol);
  }

  const fetchedAt = new Map(db.select().from(prices).all().map((p) => [p.symbol, p.fetchedAt]));
  const isStale = (s: string) => {
    const at = fetchedAt.get(s);
    return force || at === undefined || now.getTime() - at >= FRESH_MS;
  };

  const failed = new Set<string>();
  let updated = 0;
  const fxCache = new Map<string, Promise<number>>();
  const fx = (cur: string) => {
    let p = fxCache.get(cur);
    if (!p) {
      p = deps.fx(cur);
      fxCache.set(cur, p);
    }
    return p;
  };

  const groups: [Set<string>, PriceFetcher][] = [
    [stockSymbols, deps.stock],
    [cryptoSymbols, deps.crypto],
  ];
  // Actions et cryptos interrogées en parallèle ; les enregistrements restent séquentiels.
  const fetched = await Promise.all(
    groups.map(async ([set, fetcher]) => {
      const symbols = [...set].filter(isStale);
      if (symbols.length === 0) return null;
      try {
        return { symbols, result: await fetcher(symbols) };
      } catch (err) {
        console.error("[prices] récupération des cours échouée :", err);
        for (const s of symbols) failed.add(s);
        return null;
      }
    }),
  );
  for (const group of fetched) {
    if (!group) continue;
    const { symbols, result } = group;
    for (const symbol of symbols) {
      const quote = result.get(symbol);
      if (!quote || !Number.isFinite(quote.price) || quote.price <= 0) {
        failed.add(symbol);
        continue;
      }
      try {
        const cents = await toEuroCents(quote.price, quote.currency, fx);
        if (!Number.isFinite(cents)) throw new Error("Prix non fini");
        db.insert(prices)
          .values({ symbol, price: cents, currency: "EUR", fetchedAt: now.getTime() })
          .onConflictDoUpdate({
            target: prices.symbol,
            set: { price: cents, currency: "EUR", fetchedAt: now.getTime() },
          })
          .run();
        updated++;
      } catch (err) {
        console.error(`[prices] conversion impossible pour ${symbol} :`, err);
        failed.add(symbol);
      }
    }
  }
  return { updated, failed: [...failed].sort() };
}
