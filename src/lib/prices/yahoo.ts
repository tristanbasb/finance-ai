import YahooFinance from "yahoo-finance2";
import type { PriceFetcher } from "./index";

// Notices (enquête, etc.) désactivées pour garder des journaux serveur propres.
const yahoo = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

type Quote = { symbol: string; regularMarketPrice?: number; currency?: string };

const FIELDS: ("symbol" | "regularMarketPrice" | "currency")[] = [
  "symbol",
  "regularMarketPrice",
  "currency",
];

async function quoteMany(symbols: string[]): Promise<Quote[]> {
  return (await yahoo.quote(symbols, { fields: FIELDS })) as Quote[];
}

/** Cours actions/ETF via Yahoo Finance ; repli symbole par symbole si le lot échoue. */
export const yahooFetcher: PriceFetcher = async (symbols) => {
  const out = new Map<string, { price: number; currency: string }>();
  const collect = (quotes: Quote[]) => {
    for (const q of quotes) {
      if (typeof q.regularMarketPrice === "number" && q.currency) {
        out.set(q.symbol, { price: q.regularMarketPrice, currency: q.currency });
      }
    }
  };
  try {
    collect(await quoteMany(symbols));
  } catch (err) {
    if (symbols.length === 1) throw err;
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
  const q = await yahoo.quote(`EUR${cur}=X`, { fields: ["regularMarketPrice"] });
  const rate = q?.regularMarketPrice;
  if (typeof rate !== "number" || rate <= 0) throw new Error(`Taux EUR/${cur} indisponible`);
  return rate;
}
