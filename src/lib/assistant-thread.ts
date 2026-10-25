// Fil de l'assistant côté navigateur : libellés, extraits, dates relatives et fusion des pages.
// Module pur (aucun accès au DOM ni au réseau), testé avec vitest.

import type { Message, MessageKind } from "@/lib/queries/messages";

/** Message du fil tel que renvoyé (JSON) par `/api/messages`. */
export type ThreadMessage = Message;

/** Messages proactifs : écrits par Claude sans question préalable. */
export type ProactiveKind = "alert" | "weekly" | "monthly";

export function isProactive(kind: MessageKind): kind is ProactiveKind {
  return kind === "alert" || kind === "weekly" || kind === "monthly";
}

/** Titre d'un message de Claude selon son type (« Claude » pour une réponse ordinaire). */
export function kindLabel(kind: MessageKind): string {
  switch (kind) {
    case "alert":
      return "Alerte";
    case "weekly":
      return "Bilan de la semaine";
    case "monthly":
      return "Bilan du mois";
    case "divider":
      return "Nouvelle conversation";
    default:
      return "Claude";
  }
}

/**
 * Texte brut d'un markdown de réponse, sur une ligne, coupé à `max` caractères (au dernier mot
 * entier, suivi de « … »).
 */
export function excerpt(markdown: string, max = 80): string {
  const plain = markdown
    .replace(/```[^\n]*\n?/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+(.*?)[\s#]*$/gm, "$1 — ")
    .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/gm, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/(^|[^\p{L}\p{N}])[*_]([^*_\n]+)[*_](?=$|[^\p{L}\p{N}])/gu, "$1$2")
    .replace(/\s+/g, " ")
    .replace(/(?:\s*—\s*)+$/, "")
    .trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const space = cut.lastIndexOf(" ");
  const base = space > max * 0.6 ? cut.slice(0, space) : cut;
  return `${base.replace(/[\s,;:.!?–-]+$/, "")}…`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const timeFormat = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const weekdayFormat = new Intl.DateTimeFormat("fr-FR", { weekday: "long" });
const dayMonthFormat = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
const dayMonthYearFormat = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" });
const fullFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "full", timeStyle: "short" });

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Nombre de jours calendaires (fuseau local) entre deux instants. */
function calendarDays(from: number, to: number): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / (24 * HOUR));
}

/**
 * Date relative courte en français : « à l'instant », « il y a 5 min », « il y a 3 h »,
 * « hier à 14:05 », « lundi à 09:00 », « 12 oct. », « 12 oct. 2025 ».
 */
export function relativeTime(ts: number, now: number = Date.now()): string {
  const diff = now - ts;
  if (diff < MINUTE) return "à l'instant";
  if (diff < HOUR) return `il y a ${Math.floor(diff / MINUTE)} min`;
  const days = calendarDays(ts, now);
  if (days === 0) return `il y a ${Math.floor(diff / HOUR)} h`;
  const time = timeFormat.format(ts);
  if (days === 1) return `hier à ${time}`;
  if (days < 7) return `${weekdayFormat.format(ts)} à ${time}`;
  return new Date(ts).getFullYear() === new Date(now).getFullYear()
    ? dayMonthFormat.format(ts)
    : dayMonthYearFormat.format(ts);
}

/** Date complète (infobulle) : « dimanche 25 octobre 2026 à 14:05 ». */
export function fullDateTime(ts: number): string {
  return fullFormat.format(ts);
}

/** Union de deux listes de messages (la seconde l'emporte à id égal), triée par id croissant. */
export function mergeMessages(current: readonly ThreadMessage[], incoming: readonly ThreadMessage[]): ThreadMessage[] {
  const byId = new Map<number, ThreadMessage>();
  for (const m of current) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/** Messages de Claude non lus parmi `messages` (ids). */
export function unreadAssistantIds(messages: readonly ThreadMessage[]): number[] {
  return messages.filter((m) => m.role === "assistant" && m.readAt === null).map((m) => m.id);
}

/**
 * Nouveaux non-lus à signaler : ceux de `latest` absents de `seen`, du plus ancien au plus
 * récent. `seen` est complété avec tous les ids de `latest`.
 */
export function takeNewUnread(latest: readonly ThreadMessage[], seen: Set<number>): ThreadMessage[] {
  const fresh = latest.filter((m) => !seen.has(m.id));
  for (const m of latest) seen.add(m.id);
  return fresh.sort((a, b) => a.id - b.id);
}

/** Libellé de pastille : « 9+ » au-delà de 9. */
export function badgeCount(count: number): string {
  return count > 9 ? "9+" : String(count);
}
