import { randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Db } from "@/lib/db";
import { deleteSetting, getSetting, setSetting } from "@/lib/settings";

export const CHAT_ID_KEY = "telegram_chat_id";
export const LINK_CODE_KEY = "telegram_link_code";
export const LINK_CODE_TTL_MS = 10 * 60_000;

const linkCodeSchema = z.object({ code: z.string().regex(/^\d{6}$/), expiresAt: z.number() });

/** Token du bot (`TELEGRAM_BOT_TOKEN`, rogné), lu à l'appel ; null s'il est absent. */
export function telegramToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
}

/** Identifiant du chat relié, ou null. */
export function linkedChatId(db: Db): string | null {
  return getSetting<string | null>(db, CHAT_ID_KEY, z.string().min(1), null);
}

export function linkChat(db: Db, chatId: string): void {
  setSetting(db, CHAT_ID_KEY, chatId);
}

/** Délie Telegram : efface le chat relié et tout code en attente. */
export function unlinkTelegram(db: Db): void {
  deleteSetting(db, CHAT_ID_KEY);
  deleteSetting(db, LINK_CODE_KEY);
}

/** Nouveau code de liaison à 6 chiffres, valable 10 min (remplace le précédent). */
export function createLinkCode(db: Db, now: number = Date.now()): { code: string; expiresAt: number } {
  const value = { code: String(randomInt(0, 1_000_000)).padStart(6, "0"), expiresAt: now + LINK_CODE_TTL_MS };
  setSetting(db, LINK_CODE_KEY, value);
  return value;
}

/** Vrai si `code` est le code en cours et non expiré (comparaison à temps constant) ; il est alors consommé. */
export function consumeLinkCode(db: Db, code: string, now: number = Date.now()): boolean {
  const stored = getSetting(db, LINK_CODE_KEY, linkCodeSchema, null);
  if (!stored || now > stored.expiresAt || !/^\d{6}$/.test(code)) return false;
  if (!timingSafeEqual(Buffer.from(code), Buffer.from(stored.code))) return false;
  deleteSetting(db, LINK_CODE_KEY);
  return true;
}
