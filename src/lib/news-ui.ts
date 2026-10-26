/** Aides pures de la section Actualités (Patrimoine). */

/** Taille d'une page d'articles (liste initiale et « Voir plus »). */
export const NEWS_PAGE = 10;

/** Texte de l'état vide (passages horaires de 7 h à 21 h inclus). */
export const NEWS_EMPTY_HINT = "Les actualités arrivent au prochain passage (toutes les heures, de 7 h à 21 h).";

const MINUTE = 60_000;
const HOUR = 3_600_000;

const dayMonth = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
const dayMonthYear = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" });

/** Jours civils (heure locale) entre deux instants. */
function calendarDays(from: number, to: number): number {
  const a = new Date(from);
  const b = new Date(to);
  const start = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const end = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((end - start) / 86_400_000);
}

function shortDate(ts: number, now: number): string {
  return new Date(ts).getFullYear() === new Date(now).getFullYear() ? dayMonth.format(ts) : dayMonthYear.format(ts);
}

/**
 * Âge d'un article : « à l'instant », « il y a 12 min », « il y a 3 h » (même jour), « hier »,
 * puis la date courte (« 12 oct. », avec l'année si elle diffère).
 */
export function newsAge(publishedAt: number, now: number): string {
  const diff = now - publishedAt;
  if (diff < MINUTE) return "à l'instant";
  if (diff < HOUR) return `il y a ${Math.floor(diff / MINUTE)} min`;
  const days = calendarDays(publishedAt, now);
  if (days === 0) return `il y a ${Math.floor(diff / HOUR)} h`;
  if (days === 1) return "hier";
  return shortDate(publishedAt, now);
}

/** « Mis à jour il y a 3 h », « Mis à jour hier », « Mis à jour le 12 oct. ». */
export function updatedLabel(fetchedAt: number, now: number): string {
  const age = newsAge(fetchedAt, now);
  return /^\d/.test(age) ? `Mis à jour le ${age}` : `Mis à jour ${age}`;
}

/** Titre affiché (français si traduit) et, quand il diffère, le titre d'origine pour l'info-bulle. */
export function displayTitle(row: { title: string; titleFr: string | null }): { text: string; original?: string } {
  if (row.titleFr && row.titleFr !== row.title) return { text: row.titleFr, original: row.title };
  return { text: row.title };
}

/** Une page pleine laisse supposer d'autres articles (bouton « Voir plus »). */
export function hasMore(received: number, limit: number): boolean {
  return received >= limit;
}

/** Vrai si `value` est une URL absolue http(s) (vérifiée de nouveau à l'affichage avant d'en faire un lien). */
export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
