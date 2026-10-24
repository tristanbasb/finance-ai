// Formats d'affichage en français. Module pur, utilisable côté client comme côté serveur.

const percentFormatter = new Intl.NumberFormat("fr-FR", {
  style: "percent",
  maximumFractionDigits: 1,
});

const compactFormatter = new Intl.NumberFormat("fr-FR", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Espace fine insécable (U+202F), comme celle qu'insère Intl en français. */
export const NARROW_NBSP = String.fromCharCode(0x202f);

/** Fraction → pourcentage (« 12,5 % »). */
export function formatPercent(fraction: number): string {
  return percentFormatter.format(fraction);
}

/** Centimes → euros compacts pour les axes (« 12,4 k€ », « 950 € »). */
export function formatEURCompact(cents: number): string {
  const text = compactFormatter.format(cents / 100);
  return /[a-z]$/i.test(text) ? `${text}€` : `${text}${NARROW_NBSP}€`;
}

function parseIso(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

const shortDate = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
const longDate = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});
const fullDate = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const monthYear = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });

/** « 12 oct. » */
export function formatDateShort(date: string): string {
  return shortDate.format(parseIso(date));
}

/** « samedi 24 octobre » */
export function formatDateLong(date: string): string {
  return longDate.format(parseIso(date));
}

/** « 24 octobre 2026 » */
export function formatDateFull(date: string): string {
  return fullDate.format(parseIso(date));
}

/** « octobre 2026 » à partir de « 2026-10 » ou d'une date complète. */
export function formatMonth(monthOrDate: string): string {
  return monthYear.format(parseIso(`${monthOrDate.slice(0, 7)}-01`));
}
