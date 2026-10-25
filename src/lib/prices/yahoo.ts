import YahooFinance from "yahoo-finance2";
import type { PriceFetcher, PriceQuote } from "./index";
import { TimeoutError, withTimeout } from "./timeout";

// Notices (enquête, etc.) désactivées pour garder des journaux serveur propres.
const yahoo = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

/** Délai maximal par appel à Yahoo Finance. */
const TIMEOUT_MS = 8000;

type Quote = {
  symbol: string;
  regularMarketPrice?: number;
  currency?: string;
  regularMarketChangePercent?: number;
  /** Heure de la dernière cotation de la séance (Date pour yahoo-finance2). */
  regularMarketTime?: Date | number;
};

const FIELDS: ("symbol" | "regularMarketPrice" | "currency" | "regularMarketChangePercent" | "regularMarketTime")[] = [
  "symbol",
  "regularMarketPrice",
  "currency",
  "regularMarketChangePercent",
  "regularMarketTime",
];

/**
 * Cotation Yahoo → `PriceQuote` (null sans cours). `changeAt` : heure de la séance dont vient
 * la variation, qui reste celle de la dernière séance quand le marché est fermé.
 */
export function yahooQuote(q: Quote): PriceQuote | null {
  if (typeof q.regularMarketPrice !== "number" || !q.currency) return null;
  const changePct =
    typeof q.regularMarketChangePercent === "number" && Number.isFinite(q.regularMarketChangePercent)
      ? q.regularMarketChangePercent
      : undefined;
  const t = q.regularMarketTime;
  // Un nombre est un horodatage Unix en secondes (réponse brute de l'API).
  const at = t instanceof Date ? t.getTime() : typeof t === "number" ? t * 1000 : NaN;
  return { price: q.regularMarketPrice, currency: q.currency, changePct, changeAt: Number.isFinite(at) ? at : undefined };
}

async function quoteMany(symbols: string[]): Promise<Quote[]> {
  return withTimeout(
    async (signal) =>
      (await yahoo.quote(symbols, { fields: FIELDS }, { fetchOptions: { signal } })) as Quote[],
    TIMEOUT_MS,
    "Yahoo Finance",
  );
}

/** Cours actions/ETF via Yahoo Finance ; repli symbole par symbole si le lot échoue. */
export const yahooFetcher: PriceFetcher = async (symbols) => {
  const out = new Map<string, PriceQuote>();
  const collect = (quotes: Quote[]) => {
    for (const q of quotes) {
      const quote = yahooQuote(q);
      if (quote) out.set(q.symbol, quote);
    }
  };
  try {
    collect(await quoteMany(symbols));
  } catch (err) {
    // Service muet : inutile de retenter symbole par symbole (8 s chacun).
    if (symbols.length === 1 || err instanceof TimeoutError) throw err;
    for (const symbol of symbols) {
      try {
        collect(await quoteMany([symbol]));
      } catch {
        // symbole invalide : absent du résultat, donc signalé en échec
      }
    }
  }
  return out;
};

/** Unités de `cur` pour 1 EUR, via la paire EUR{cur}=X. */
export async function yahooFx(cur: string): Promise<number> {
  if (cur === "EUR") return 1;
  const q = await withTimeout(
    (signal) => yahoo.quote(`EUR${cur}=X`, { fields: ["regularMarketPrice"] }, { fetchOptions: { signal } }),
    TIMEOUT_MS,
    "Yahoo Finance (change)",
  );
  const rate = q?.regularMarketPrice;
  if (typeof rate !== "number" || rate <= 0) throw new Error(`Taux EUR/${cur} indisponible`);
  return rate;
}
