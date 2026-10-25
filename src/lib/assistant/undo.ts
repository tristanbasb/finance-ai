import { eq, max } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { messages } from "@/lib/db/schema";
import { ACTION_NOT_FOUND, actionStatus, undoAction } from "@/lib/ai/actions";
import { runAlertChecksSoon } from "@/lib/alerts/trigger";
import { pendingUserMessages, type Message } from "@/lib/queries/messages";
import { postAssistantMessage } from "./conversation";

export type UndoOutcome =
  | { ok: true; summary: string; message: Message }
  | { ok: false; reason: string; notFound?: true };

export const UNDONE_PREFIX = "Action annulée : ";

/**
 * Annule une action de Claude (app : `POST /api/ai/actions/[id]/undo` ; Telegram : bouton ou
 * `/annuler`) puis l'annonce dans le fil par un message système « Action annulée : <résumé> »
 * (kind `chat`, source `system`, déjà lu, sans appel à Claude), diffusé à tous les canaux sauf
 * `except` (le canal d'où vient l'annulation, qui affiche lui-même le résultat). Relance les
 * contrôles d'alerte sur les données restaurées. Refus : `{ ok: false, reason }` (`notFound`
 * si l'id n'existe pas), sans message ni modification.
 */
export async function undoAndAnnounce(
  db: Db,
  id: number,
  { except, now = Date.now() }: { except?: string; now?: number } = {},
): Promise<UndoOutcome> {
  // Lignes restaurées, lues avant l'annulation (le journal ne change pas ensuite).
  const { changes } = actionStatus(db, id, now);
  const result = undoAction(db, id, now);
  if (!result.ok) {
    return result.reason === ACTION_NOT_FOUND ? { ok: false, reason: result.reason, notFound: true } : result;
  }

  const restoredTx = changes.filter((c) => c.table === "transactions" && c.before !== null).map((c) => c.id);
  runAlertChecksSoon(db, { txIds: [...new Set(restoredTx)], expenseRule: false, goals: true });

  // Message `chat` : son `meta.replyTo` doit laisser en attente les questions encore sans
  // réponse (sinon `pendingUserMessages` les croirait traitées par ce message).
  const pending = pendingUserMessages(db);
  const replyTo = pending.length ? pending[0].id - 1 : lastUserMessageId(db);
  const message = await postAssistantMessage(
    db,
    { kind: "chat", content: `${UNDONE_PREFIX}${result.summary}`, meta: { undoneAction: id, replyTo }, read: true },
    { except },
  );
  return { ok: true, summary: result.summary, message };
}

function lastUserMessageId(db: Db): number {
  // Aucune question en attente : tout message utilisateur existant est déjà traité.
  return db.select({ id: max(messages.id) }).from(messages).where(eq(messages.role, "user")).get()?.id ?? 0;
}
