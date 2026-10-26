import YahooFinance from "yahoo-finance2";
import { withTimeout } from "@/lib/prices/timeout";

// Notices (enquête, etc.) désactivées pour garder des journaux serveur propres.
const yahoo = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

/** Délai maximal par appel à Yahoo Finance. */
const TIMEOUT_MS = 8000;

export type NewsItem = {
  uuid: string;
  title: string;
  publisher: string;
  link: string;
  /** Date de publication (ms depuis l'epoch). */
  publishedAt: number;
  relatedTickers: string[];
};

export type NewsFetcher = (query: string) => Promise<NewsItem[]>;

/**
 * Requête Yahoo pour une position. Un symbole crypto de 1 à 6 caractères alphanumériques,
 * entièrement en majuscules ou de 3 caractères au plus (« BTC », « btc », « ABCDEF »), devient
 * une paire en majuscules (« BTC-USD ») ; les autres identifiants (« bitcoin », « solana ») et
 * les symboles d'actions ou d'ETF sont transmis tels quels.
 */
export function newsQuery(symbol: string, assetType: "stock" | "etf" | "crypto"): string {
  if (
    assetType === "crypto" &&
    /^[A-Za-z0-9]{1,6}$/.test(symbol) &&
    (symbol === symbol.toUpperCase() || symbol.length <= 3)
  ) {
    return `${symbol.toUpperCase()}-USD`;
  }
  return symbol;
}

/** Réponse brute de Yahoo → articles valides (uuid, titre, date et lien http(s) requis). */
export function parseYahooNews(raw: unknown[]): NewsItem[] {
  const items: NewsItem[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const r = entry as Record<string, unknown>;
    const title = typeof r.title === "string" ? r.title.trim() : "";
    if (typeof r.uuid !== "string" || !r.uuid || !title) continue;
    const t = r.providerPublishTime;
    // Un nombre est un horodatage Unix en secondes (réponse brute de l'API).
    const publishedAt = t instanceof Date ? t.getTime() : typeof t === "number" ? t * 1000 : NaN;
    if (!Number.isFinite(publishedAt)) continue;
    let link: URL;
    try {
      link = new URL(String(r.link));
    } catch {
      continue;
    }
    if (link.protocol !== "http:" && link.protocol !== "https:") continue;
    items.push({
      uuid: r.uuid,
      title,
      publisher: typeof r.publisher === "string" ? r.publisher : "",
      link: link.href,
      publishedAt,
      relatedTickers: Array.isArray(r.relatedTickers)
        ? r.relatedTickers.filter((s): s is string => typeof s === "string")
        : [],
    });
  }
  return items;
}

/** Récupère les dernières actualités Yahoo pour une requête (symbole). */
export const yahooNewsFetcher: NewsFetcher = async (query) => {
  const res = await withTimeout(
    (signal) => yahoo.search(query, { newsCount: 10, quotesCount: 0 }, { fetchOptions: { signal } }),
    TIMEOUT_MS,
    "Yahoo Finance",
  );
  return parseYahooNews(res.news ?? []);
};
