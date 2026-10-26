import { getAi, type Ai } from "@/lib/ai/client";
import { getDb, type Db } from "@/lib/db";
import { newsQuery, yahooNewsFetcher, type NewsFetcher } from "./yahoo";
import { activeHoldings, purgeNews, saveNews } from "./store";
import { translatePendingTitles } from "./translate";

export type NewsDeps = { fetch: NewsFetcher; ai: () => Ai | null };

export function realNewsDeps(): NewsDeps {
  return { fetch: yahooNewsFetcher, ai: () => getAi(getDb()) };
}

/** Nombre maximal d'appels simultanés à Yahoo Finance. */
const FETCH_CONCURRENCY = 4;

/** Heures locales d'actualisation : de 7 h (incluse) à 22 h (exclue) : dernier passage à 21 h. */
export function isNewsHour(now: Date): boolean {
  const h = now.getHours();
  return h >= 7 && h < 22;
}

/** Exécute `work` sur chaque élément, `limit` à la fois au plus. */
async function forEachLimited<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await work(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * Récupère (Yahoo, 4 symboles à la fois) les actualités des positions actives (actions, ETF,
 * cryptos des comptes non archivés), les enregistre puis purge les anciennes. Aucun appel à
 * l'IA. Un échec par symbole est journalisé et n'arrête pas les autres. Renvoie le nombre
 * d'articles nouveaux. Ne lève jamais.
 */
export async function fetchNews(db: Db, deps: NewsDeps, now: Date): Promise<number> {
  let added = 0;
  try {
    const active = activeHoldings(db);
    const held = new Set(active.keys());
    await forEachLimited([...active], FETCH_CONCURRENCY, async ([symbol, { assetType }]) => {
      try {
        const items = await deps.fetch(newsQuery(symbol, assetType));
        added += saveNews(db, symbol, items, held, now.getTime());
      } catch (err) {
        console.warn(`[actualités] ${symbol} :`, err);
      }
    });
    purgeNews(db, now.getTime());
  } catch (err) {
    console.warn("[actualités] récupération échouée :", err);
  }
  return added;
}

/** Traduit les titres en attente (voir `translatePendingTitles`). Ne lève jamais. */
export async function translateNews(db: Db, deps: NewsDeps, now: Date): Promise<number> {
  try {
    return await translatePendingTitles(db, deps.ai(), now.getTime());
  } catch (err) {
    console.warn("[actualités] traduction échouée :", err);
    return 0;
  }
}
