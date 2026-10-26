import { and, desc, eq, gte, inArray, lt, max, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { accounts, holdings, news, newsSymbols } from "@/lib/db/schema";
import type { NewsItem } from "./yahoo";

/** Durée de conservation des actualités. */
const RETENTION_MS = 30 * 86_400_000;

/**
 * Enregistre les articles (dédoublonnés par uuid) et les lie au symbole interrogé ainsi qu'à
 * chaque ticker associé détenu (`held`, en majuscules). Renvoie le nombre d'articles nouveaux.
 */
export function saveNews(db: Db, symbol: string, items: NewsItem[], held: Set<string>, now: number): number {
  let created = 0;
  db.transaction((tx) => {
    for (const it of items) {
      const inserted = tx
        .insert(news)
        .values({
          uuid: it.uuid,
          title: it.title,
          publisher: it.publisher,
          link: it.link,
          publishedAt: it.publishedAt,
          fetchedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: news.id })
        .get();
      if (inserted) created++;
      const id = inserted?.id ?? tx.select({ id: news.id }).from(news).where(eq(news.uuid, it.uuid)).get()!.id;
      const symbols = new Set([symbol.toUpperCase()]);
      for (const t of it.relatedTickers) if (held.has(t.toUpperCase())) symbols.add(t.toUpperCase());
      for (const s of symbols) tx.insert(newsSymbols).values({ newsId: id, symbol: s }).onConflictDoNothing().run();
    }
  });
  return created;
}

/** Supprime les articles publiés il y a plus de 30 jours (leurs liaisons suivent en cascade). */
export function purgeNews(db: Db, now: number): void {
  db.delete(news)
    .where(lt(news.publishedAt, now - RETENTION_MS))
    .run();
}

/**
 * Titres (français si traduit, sinon d'origine) des articles liés à `symbol` (en majuscules)
 * publiés depuis `since` (ms), les plus récents d'abord.
 */
export function recentTitles(db: Db, symbol: string, since: number, limit: number): string[] {
  return db
    .select({ title: news.title, titleFr: news.titleFr })
    .from(news)
    .innerJoin(newsSymbols, eq(newsSymbols.newsId, news.id))
    .where(and(eq(newsSymbols.symbol, symbol), gte(news.publishedAt, since)))
    .orderBy(desc(news.publishedAt), desc(news.id))
    .limit(limit)
    .all()
    .map((r) => r.titleFr ?? r.title);
}

/** Article tel qu'affiché dans la section Actualités (symboles limités aux positions actives). */
export type NewsRow = {
  id: number;
  title: string;
  titleFr: string | null;
  publisher: string;
  link: string;
  publishedAt: number;
  symbols: string[];
};

/**
 * Positions actives suivies (actions, ETF, cryptos des comptes non archivés) : symbole en
 * majuscules → nom de la première position rencontrée, triées par symbole.
 */
function activeSymbols(db: Db): Map<string, string> {
  const rows = db
    .select({ symbol: holdings.symbol, name: holdings.name })
    .from(holdings)
    .innerJoin(accounts, eq(accounts.id, holdings.accountId))
    .where(and(inArray(holdings.assetType, ["stock", "etf", "crypto"]), eq(accounts.archived, false)))
    .orderBy(holdings.id)
    .all();
  const out = new Map<string, string>();
  for (const r of rows) {
    const symbol = r.symbol.trim().toUpperCase();
    if (symbol && !out.has(symbol)) out.set(symbol, r.name);
  }
  return new Map([...out].sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Articles liés aux positions actives (ou à `symbol` seul s'il est détenu), les plus récents
 * d'abord. Pagination par curseur : `before` (date, strict) et, pour départager les articles de
 * même date, `beforeId` (articles de date `before` et d'id inférieur).
 */
export function listNews(
  db: Db,
  opts: { symbol?: string; before?: number; beforeId?: number; limit: number },
): NewsRow[] {
  const active = activeSymbols(db);
  const wanted = opts.symbol === undefined ? [...active.keys()] : [opts.symbol.trim().toUpperCase()];
  const symbols = wanted.filter((s) => active.has(s));
  if (symbols.length === 0) return [];

  const conds: SQL[] = [
    sql`exists (select 1 from ${newsSymbols} where ${newsSymbols.newsId} = ${news.id} and ${inArray(newsSymbols.symbol, symbols)})`,
  ];
  if (opts.before !== undefined) {
    conds.push(
      opts.beforeId === undefined
        ? lt(news.publishedAt, opts.before)
        : or(lt(news.publishedAt, opts.before), and(eq(news.publishedAt, opts.before), lt(news.id, opts.beforeId)))!,
    );
  }
  const rows = db
    .select({
      id: news.id,
      title: news.title,
      titleFr: news.titleFr,
      publisher: news.publisher,
      link: news.link,
      publishedAt: news.publishedAt,
    })
    .from(news)
    .where(and(...conds))
    .orderBy(desc(news.publishedAt), desc(news.id))
    .limit(opts.limit)
    .all();
  if (rows.length === 0) return [];

  const links = db
    .select({ newsId: newsSymbols.newsId, symbol: newsSymbols.symbol })
    .from(newsSymbols)
    .where(
      and(
        inArray(
          newsSymbols.newsId,
          rows.map((r) => r.id),
        ),
        inArray(newsSymbols.symbol, [...active.keys()]),
      ),
    )
    .orderBy(newsSymbols.symbol)
    .all();
  const byNews = new Map<number, string[]>();
  for (const l of links) byNews.set(l.newsId, [...(byNews.get(l.newsId) ?? []), l.symbol]);
  return rows.map((r) => ({ ...r, symbols: byNews.get(r.id) ?? [] }));
}

/**
 * Nombre d'articles publiés depuis `since` (ms) pour chaque position active (0 possible), du
 * plus grand nombre au plus petit puis par symbole. Vide sans position cotée.
 */
export function newsCounts(db: Db, since: number): { symbol: string; name: string; count: number }[] {
  const active = activeSymbols(db);
  if (active.size === 0) return [];
  const rows = db
    .select({ symbol: newsSymbols.symbol, count: sql<number>`count(*)` })
    .from(newsSymbols)
    .innerJoin(news, eq(news.id, newsSymbols.newsId))
    .where(and(inArray(newsSymbols.symbol, [...active.keys()]), gte(news.publishedAt, since)))
    .groupBy(newsSymbols.symbol)
    .all();
  const counts = new Map(rows.map((r) => [r.symbol, Number(r.count)]));
  return [...active]
    .map(([symbol, name]) => ({ symbol, name, count: counts.get(symbol) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.symbol.localeCompare(b.symbol));
}

/** Date (ms) de la dernière récupération d'actualités, ou `null` s'il n'y en a aucune. */
export function lastNewsFetch(db: Db): number | null {
  return db.select({ at: max(news.fetchedAt) }).from(news).get()?.at ?? null;
}
