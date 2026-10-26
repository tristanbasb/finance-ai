import { and, eq, inArray } from "drizzle-orm";
import { getAi, type Ai } from "@/lib/ai/client";
import { getDb, type Db } from "@/lib/db";
import { accounts, holdings } from "@/lib/db/schema";
import { newsQuery, yahooNewsFetcher, type NewsFetcher } from "./yahoo";
import { purgeNews, saveNews } from "./store";
import { translatePendingTitles } from "./translate";

export type NewsDeps = { fetch: NewsFetcher; ai: () => Ai | null };

export function realNewsDeps(): NewsDeps {
  return { fetch: yahooNewsFetcher, ai: () => getAi(getDb()) };
}

/** Heures locales d'actualisation : de 7 h (incluse) à 22 h (exclue). */
export function isNewsHour(now: Date): boolean {
  const h = now.getHours();
  return h >= 7 && h < 22;
}

/**
 * Récupère les actualités des positions actives (actions, ETF, cryptos des comptes non
 * archivés), purge les anciennes puis traduit les titres en attente. Un échec par symbole est
 * journalisé et n'arrête pas les autres. Ne lève jamais.
 */
export async function refreshNews(
  db: Db,
  deps: NewsDeps,
  now: Date,
): Promise<{ added: number; translated: number }> {
  let added = 0;
  let translated = 0;
  try {
    const rows = db
      .select({ symbol: holdings.symbol, assetType: holdings.assetType })
      .from(holdings)
      .innerJoin(accounts, eq(accounts.id, holdings.accountId))
      .where(and(inArray(holdings.assetType, ["stock", "etf", "crypto"]), eq(accounts.archived, false)))
      .all();
    const active = new Map<string, "stock" | "etf" | "crypto">();
    for (const r of rows) {
      const symbol = r.symbol.trim().toUpperCase();
      if (symbol && !active.has(symbol)) active.set(symbol, r.assetType as "stock" | "etf" | "crypto");
    }
    const held = new Set(active.keys());
    for (const [symbol, assetType] of active) {
      try {
        const items = await deps.fetch(newsQuery(symbol, assetType));
        added += saveNews(db, symbol, items, held, now.getTime());
      } catch (err) {
        console.warn(`[actualités] ${symbol} :`, err);
      }
    }
    purgeNews(db, now.getTime());
    translated = await translatePendingTitles(db, deps.ai(), now.getTime());
  } catch (err) {
    console.warn("[actualités] actualisation échouée :", err);
  }
  return { added, translated };
}
