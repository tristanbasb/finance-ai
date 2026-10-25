import type { DigestPrefs } from "@/lib/settings";

const pad = (n: number) => String(n).padStart(2, "0");
const MONTHS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

export type DigestKind = "weekly" | "monthly";

/** Semaine ISO-8601 (règle du jeudi) de la date locale : `YYYY-Www`. */
export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dow = d.getUTCDay() || 7; // lundi = 1 … dimanche = 7
  d.setUTCDate(d.getUTCDate() + 4 - dow); // jeudi de la semaine
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${pad(week)}`;
}

/** Mois local : `YYYY-MM`. */
export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

/** Heure locale : `YYYY-MM-DDTHH`. */
export function hourKey(date: Date): string {
  return `${monthKey(date)}-${pad(date.getDate())}T${pad(date.getHours())}`;
}

/**
 * Bilans à envoyer maintenant. La période mémorisée est la période COURANTE (celle où le bilan
 * est envoyé) : un seul bilan par semaine / par mois, avec rattrapage si l'heure est passée.
 */
export function dueDigests(
  now: Date,
  prefs: DigestPrefs,
  lastRuns: { weekly?: string; monthly?: string },
): DigestKind[] {
  const due: DigestKind[] = [];
  const hourOk = now.getHours() >= prefs.hour;
  if (prefs.weekly && (now.getDay() !== 1 || hourOk) && lastRuns.weekly !== isoWeek(now)) due.push("weekly");
  if (prefs.monthly && (now.getDate() > 1 || hourOk) && lastRuns.monthly !== monthKey(now)) due.push("monthly");
  return due;
}

export type DigestPeriod = { start: string; end: string; title: string };

const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayMonth = (d: Date) => `${d.getDate() === 1 ? "1er" : d.getDate()} ${MONTHS[d.getMonth()]}`;

/** Semaine ISO précédente (lundi → dimanche) ou mois calendaire précédent. */
export function digestPeriod(kind: DigestKind, now: Date): DigestPeriod {
  if (kind === "monthly") {
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last = new Date(now.getFullYear(), now.getMonth(), 0);
    return {
      start: iso(first),
      end: iso(last),
      title: `Bilan de ${MONTHS[first.getMonth()]} ${first.getFullYear()}`,
    };
  }
  const dow = now.getDay() || 7;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow + 1 - 7);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  const from = start.getMonth() === end.getMonth() ? String(start.getDate()) : dayMonth(start);
  return { start: iso(start), end: iso(end), title: `Bilan de la semaine du ${from} au ${dayMonth(end)}` };
}
