import { ConflictError, withErrors } from "@/lib/api";
import { getDb } from "@/lib/db";
import { botUsername } from "@/lib/telegram/api";
import { createLinkCode, telegramToken, unlinkTelegram } from "@/lib/telegram/link";

export const dynamic = "force-dynamic";

/** Nouveau code de liaison → `{ code, expiresAt, botUsername }` ; 409 sans `TELEGRAM_BOT_TOKEN`. */
export const POST = withErrors(async () => {
  const token = telegramToken();
  if (!token) throw new ConflictError("Telegram n'est pas configuré");
  const { code, expiresAt } = createLinkCode(getDb());
  return Response.json({ code, expiresAt, botUsername: await botUsername(token) });
});

/** Délie Telegram (chat relié et code en attente effacés) → `{ ok: true }`. */
export const DELETE = withErrors(async () => {
  unlinkTelegram(getDb());
  return Response.json({ ok: true });
});
