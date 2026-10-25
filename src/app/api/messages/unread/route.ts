import { withErrors } from "@/lib/api";
import { getDb } from "@/lib/db";
import { unreadSummary } from "@/lib/queries/messages";

export const dynamic = "force-dynamic";

/** Messages de l'assistant non lus : `{ count, latest, lastId }` (10 plus récents au plus ; `lastId` :
 * dernier message du fil, lu ou non). */
export const GET = withErrors(async () => Response.json(unreadSummary(getDb())));
