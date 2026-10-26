/** Aides pures des réglages (notifications, Telegram) : formats et bornes. */

/** Libellé d'une heure d'envoi : 8 → « 8 h ». */
export function hourLabel(hour: number): string {
  return `${hour} h`;
}

/** Les 24 heures proposées pour l'envoi des bilans. */
export const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({ value: h, label: hourLabel(h) }));

/** Compte à rebours « m:ss » ; 0 si l'échéance est passée. */
export function formatCountdown(msLeft: number): string {
  const total = Math.max(0, Math.ceil(msLeft / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function toNumber(raw: string): number | null {
  const text = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (text === "" || !/^\d+(\.\d+)?$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** Seuil des dépenses inhabituelles en € : nombre ≥ 1, sinon null. */
export function parseUnusualMinEur(raw: string): number | null {
  const n = toNumber(raw);
  return n !== null && n >= 1 ? n : null;
}

/** Seuil des variations en % : nombre > 0, sinon null. */
export function parsePriceMovePct(raw: string): number | null {
  const n = toNumber(raw);
  return n !== null && n > 0 ? n : null;
}

/** Nombre pour un champ de saisie, virgule décimale française. */
export function numberToInput(n: number): string {
  return String(n).replace(".", ",");
}

/** Lien direct vers le bot : `/start CODE` est pré-rempli par Telegram. */
export function botDeepLink(botUsername: string, code: string): string {
  return `https://t.me/${botUsername}?start=${code}`;
}

/** Rétablit dans `state` uniquement les clés de `patch`, avec leurs valeurs de `previous` (échec d'un enregistrement). */
export function revertKeys<T extends object>(state: T, previous: T, patch: Partial<T>): T {
  const next = { ...state };
  for (const key of Object.keys(patch) as (keyof T)[]) next[key] = previous[key];
  return next;
}

/** Rubriques de la page Réglages, dans l'ordre d'affichage : ancre et libellé du sommaire. */
export const SETTINGS_SECTIONS = [
  { id: "comptes", label: "Comptes" },
  { id: "categories", label: "Catégories" },
  { id: "recurrentes", label: "Dépenses récurrentes" },
  { id: "ia", label: "Assistant IA" },
  { id: "notifications", label: "Notifications" },
  { id: "telegram", label: "Telegram" },
  { id: "donnees", label: "Données" },
  { id: "securite", label: "Sécurité" },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

/**
 * Rubrique courante du sommaire : la dernière dont le haut a dépassé `threshold` (px depuis le
 * haut de la fenêtre), ou la dernière rubrique quand la page est défilée jusqu'en bas.
 */
export function activeSection(
  tops: readonly { id: SettingsSectionId; top: number }[],
  threshold: number,
  atBottom: boolean,
): SettingsSectionId {
  if (tops.length === 0) return SETTINGS_SECTIONS[0].id;
  if (atBottom) return tops[tops.length - 1].id;
  let current = tops[0].id;
  for (const t of tops) if (t.top <= threshold) current = t.id;
  return current;
}

/** Les douze mois, en minuscules (janvier = indice 0). */
export const FRENCH_MONTHS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
] as const;

export type RecurringFrequency = "monthly" | "quarterly" | "yearly";

/** Fréquence lisible d'une dépense récurrente : « Tous les mois », « Chaque année en mars »… */
export function frequencyLabel(frequency: RecurringFrequency, anchorMonth: number | null): string {
  if (frequency === "monthly" || anchorMonth === null) return "Tous les mois";
  const month = FRENCH_MONTHS[anchorMonth - 1] ?? "";
  return frequency === "quarterly" ? `Tous les 3 mois (à partir de ${month})` : `Chaque année en ${month}`;
}
