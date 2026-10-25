import { withErrors } from "@/lib/api";
import { getDb } from "@/lib/db";
import { unreadSummary } from "@/lib/queries/messages";

export const dynamic = "force-dynamic";

/** Messages de l'assistant non lus : `{ count, latest }` (10 plus récents au plus). */
export const GET = withErrors(async () => Response.json(unreadSummary(getDb())));
