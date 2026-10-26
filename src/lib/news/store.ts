import { and, desc, eq, gte, lt } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { news, newsSymbols } from "@/lib/db/schema";
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
