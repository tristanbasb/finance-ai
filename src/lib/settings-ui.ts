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

/** Seuil des dépenses inhabituelles en € : nombre ≥ 0, sinon null. */
export function parseUnusualMinEur(raw: string): number | null {
  return toNumber(raw);
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
