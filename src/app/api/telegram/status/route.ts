import { withErrors } from "@/lib/api";
import { getDb } from "@/lib/db";
import { botUsername } from "@/lib/telegram/api";
import { linkedChatId, telegramToken } from "@/lib/telegram/link";

export const dynamic = "force-dynamic";

/** `{ configured, linked, botUsername }` (nom du bot via `getMe`, en cache 1 h ; null si erreur). */
export const GET = withErrors(async () => {
  const token = telegramToken();
  const linked = linkedChatId(getDb()) !== null;
  return Response.json({ configured: token !== null, linked, botUsername: token ? await botUsername(token) : null });
});
