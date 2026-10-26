"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ExternalLink, Newspaper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/http";
import { NEWS_PAGE, displayTitle, hasMore, newsAge, updatedLabel } from "@/lib/news-ui";
import type { NewsRow } from "@/lib/news/store";

export type NewsCount = { symbol: string; name: string; count: number };

export type NewsSectionProps = {
  /** Premiers articles (toutes positions), les plus récents d'abord. */
  initial: NewsRow[];
  /** Une entrée par position cotée active, avec le nombre d'articles des 7 derniers jours. */
  counts: NewsCount[];
  /** Date (ms) de la dernière récupération, ou `null`. */
  lastFetch: number | null;
};

const scrollRow =
  "-mx-4 -my-1.5 flex gap-2 overflow-x-auto px-4 py-2.5 [scrollbar-width:none] sm:-mx-6 sm:px-6 md:mx-0 md:my-0 md:flex-wrap md:overflow-visible md:px-0 md:py-1 [&::-webkit-scrollbar]:hidden";

const fullDate = new Intl.DateTimeFormat("fr-FR", { dateStyle: "full", timeStyle: "short" });

async function fetchNews(symbol: string | null, before?: NewsRow): Promise<NewsRow[]> {
  const params = new URLSearchParams({ limit: String(NEWS_PAGE) });
  if (symbol) params.set("symbol", symbol);
  if (before) {
    params.set("before", String(before.publishedAt));
    params.set("beforeId", String(before.id));
  }
  const res = await fetch(`/api/news?${params}`);
  if (!res.ok) throw new Error(await errorMessage(res));
  return ((await res.json()) as { items: NewsRow[] }).items;
}

/** Section « Actualités » : titres de presse liés aux positions cotées, filtrables par symbole. */
export function NewsSection({ initial, counts, lastFetch }: NewsSectionProps) {
  const [symbol, setSymbol] = useState<string | null>(null);
  const [items, setItems] = useState(initial);
  const [more, setMore] = useState(hasMore(initial.length, NEWS_PAGE));
  const [filtering, setFiltering] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Dernière requête lancée : une réponse plus ancienne (filtre changé entre-temps) est ignorée.
  const request = useRef(0);

  // Dates relatives calculées après l'hydratation (l'heure du serveur peut différer).
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setNow(Date.now()), 0);
    const i = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      clearTimeout(t);
      clearInterval(i);
    };
  }, []);

  async function choose(next: string | null) {
    if (next === symbol) return;
    const id = ++request.current;
    setSymbol(next);
    setLoadingMore(false);
    if (next === null) {
      setItems(initial);
      setMore(hasMore(initial.length, NEWS_PAGE));
      setFiltering(false);
      return;
    }
    setFiltering(true);
    try {
      const rows = await fetchNews(next);
      if (id !== request.current) return;
      setItems(rows);
      setMore(hasMore(rows.length, NEWS_PAGE));
    } catch (err) {
      if (id !== request.current) return;
      toast.error("Chargement impossible", { description: err instanceof Error ? err.message : undefined });
    } finally {
      if (id === request.current) setFiltering(false);
    }
  }

  async function loadMore() {
    const last = items.at(-1);
    if (!last) return;
    const id = ++request.current;
    setLoadingMore(true);
    try {
      const rows = await fetchNews(symbol, last);
      if (id !== request.current) return;
      setItems((prev) => [...prev, ...rows.filter((r) => !prev.some((p) => p.id === r.id))]);
      setMore(hasMore(rows.length, NEWS_PAGE));
    } catch (err) {
      if (id !== request.current) return;
      toast.error("Chargement impossible", { description: err instanceof Error ? err.message : undefined });
    } finally {
      if (id === request.current) setLoadingMore(false);
    }
  }

  if (counts.length === 0) return null;

  const selected = counts.find((c) => c.symbol === symbol);

  return (
    <section id="actualites" aria-labelledby="patrimoine-actualites" className="scroll-mt-section space-y-4">
      <div className="space-y-0.5 px-1">
        <h2 id="patrimoine-actualites" className="text-xl font-semibold tracking-[-0.02em] text-fg">
          Actualités
        </h2>
        <p className="text-[13px] text-muted">
          {lastFetch !== null && now !== null ? (
            <time dateTime={new Date(lastFetch).toISOString()} title={fullDate.format(lastFetch)}>
              {updatedLabel(lastFetch, now)}
            </time>
          ) : (
            "Titres de presse liés à vos positions"
          )}
        </p>
      </div>

      <div role="group" aria-label="Filtrer les actualités par position" className={scrollRow}>
        {/* Pas de total : un article lié à plusieurs positions serait compté plusieurs fois. */}
        <Chip selected={symbol === null} onClick={() => choose(null)}>
          Toutes
        </Chip>
        {counts.map((c) => (
          <Chip
            key={c.symbol}
            selected={symbol === c.symbol}
            onClick={() => choose(c.symbol)}
            title={c.name}
            aria-label={`${c.symbol} (${c.name}) : ${c.count} ${c.count > 1 ? "actualités" : "actualité"} sur 7 jours`}
          >
            <span className="font-mono">{c.symbol}</span>
            <CountBadge count={c.count} selected={symbol === c.symbol} />
          </Chip>
        ))}
      </div>

      {items.length === 0 && !filtering ? (
        <EmptyState
          icon={Newspaper}
          title={selected ? `Aucune actualité pour ${selected.symbol}` : "Aucune actualité pour l'instant"}
          description="Les actualités arrivent au prochain passage (toutes les heures, de 7 h à 22 h)."
        />
      ) : (
        <Card className="overflow-hidden">
          <ul
            aria-busy={filtering || undefined}
            aria-label={selected ? `Actualités de ${selected.symbol}` : "Actualités de vos positions"}
            className={cn("divide-y divide-border transition-opacity", filtering && "opacity-60")}
          >
            {items.map((row) => (
              <NewsItem key={row.id} row={row} now={now} />
            ))}
          </ul>
          {more && (
            <div className="flex justify-center border-t border-border px-5 py-3 sm:px-6">
              <Button variant="secondary" size="sm" onClick={loadMore} loading={loadingMore} disabled={filtering}>
                {!loadingMore && <ChevronDown aria-hidden />}
                Voir plus
              </Button>
            </div>
          )}
        </Card>
      )}
      <p aria-live="polite" className="sr-only">
        {filtering || loadingMore ? "Chargement des actualités" : `${items.length} actualités affichées`}
      </p>
    </section>
  );
}

function CountBadge({ count, selected }: { count: number; selected: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "num inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold",
        selected ? "bg-white/25 text-white" : "bg-surface-2 text-muted",
      )}
    >
      {count}
    </span>
  );
}

function NewsItem({ row, now }: { row: NewsRow; now: number | null }) {
  const title = displayTitle(row);
  return (
    <li>
      <a
        href={row.link}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:px-6"
      >
        <span className="min-w-0 flex-1">
          <span title={title.original} className="block text-[14px] font-semibold leading-snug tracking-[-0.01em] text-fg group-hover:text-brand">
            {title.text}
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
            {row.symbols.map((s) => (
              <span
                key={s}
                className="inline-flex h-5 items-center rounded-full bg-brand-soft px-2 font-mono text-[11px] font-semibold text-brand"
              >
                {s}
              </span>
            ))}
            {row.publisher && <span className="min-w-0 break-words font-medium">{row.publisher}</span>}
            <span aria-hidden className="text-subtle">
              ·
            </span>
            <time dateTime={new Date(row.publishedAt).toISOString()} className="text-subtle">
              {now === null ? " " : newsAge(row.publishedAt, now)}
            </time>
          </span>
        </span>
        <ExternalLink aria-hidden className="mt-0.5 size-4 shrink-0 text-subtle group-hover:text-brand" />
        <span className="sr-only">(s&apos;ouvre dans un nouvel onglet)</span>
      </a>
    </li>
  );
}
