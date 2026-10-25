import { and, asc, desc, eq, gt, inArray, isNull, lt, max, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { messages } from "@/lib/db/schema";

export type MessageKind = "chat" | "alert" | "weekly" | "monthly" | "divider";
export type MessageRole = "user" | "assistant" | "divider";
export type MessageSource = "app" | "telegram" | "system";

type Row = typeof messages.$inferSelect;
export type Message = Omit<Row, "meta"> & { meta: Record<string, unknown> | null };

function toMessage(row: Row): Message {
  let meta: Record<string, unknown> | null = null;
  if (row.meta) {
    try {
      const parsed: unknown = JSON.parse(row.meta);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        meta = parsed as Record<string, unknown>;
      }
    } catch {
      meta = null;
    }
  }
  return { ...row, meta };
}

export function addMessage(
  db: Db,
  m: {
    role: MessageRole;
    kind: MessageKind;
    content: string;
    source: MessageSource;
    meta?: Record<string, unknown> | null;
    now?: number;
    /** Déjà lu (message système sans intérêt de notification) : date de lecture. */
    readAt?: number | null;
  },
): Message {
  const row = db
    .insert(messages)
    .values({
      role: m.role,
      kind: m.kind,
      content: m.content,
      source: m.source,
      meta: m.meta ? JSON.stringify(m.meta) : null,
      createdAt: m.now ?? Date.now(),
      ...(m.readAt != null ? { readAt: m.readAt } : {}),
    })
    .returning()
    .get();
  return toMessage(row);
}

/** Messages en ordre chronologique ; `before` = id exclusif, `limit` 50 (max 200). */
export function listMessages(db: Db, opts: { before?: number; limit?: number } = {}): Message[] {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 50), 1), 200);
  const rows = db
    .select()
    .from(messages)
    .where(opts.before === undefined ? undefined : lt(messages.id, opts.before))
    .orderBy(desc(messages.id))
    .limit(limit)
    .all();
  return rows.reverse().map(toMessage);
}

const unreadWhere = and(
  eq(messages.role, "assistant"),
  isNull(messages.readAt),
);

/**
 * Non-lus de Claude (`count`, 10 plus récents dans `latest`) et `lastId`, id du dernier message
 * du fil, lu ou non (0 si vide) : l'app recharge son fil quand il change (note d'annulation
 * déjà lue postée depuis Telegram, par exemple).
 */
export function unreadSummary(db: Db): { count: number; latest: Message[]; lastId: number } {
  const count = db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(messages)
    .where(unreadWhere)
    .get()?.n ?? 0;
  const latest = db
    .select()
    .from(messages)
    .where(unreadWhere)
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(10)
    .all()
    .map(toMessage);
  const lastId = db.select({ id: max(messages.id) }).from(messages).get()?.id ?? 0;
  return { count, latest, lastId };
}

/** Marque des messages assistant comme lus ; retourne le nombre de lignes modifiées. */
export function markRead(
  db: Db,
  target: { ids?: number[]; all?: boolean },
  now: number = Date.now(),
): number {
  if (!target.all && !target.ids?.length) return 0;
  const scope = target.all ? unreadWhere : and(unreadWhere, inArray(messages.id, target.ids ?? []));
  return db.update(messages).set({ readAt: now }).where(scope).run().changes;
}

/**
 * Contexte envoyé à Claude : depuis le dernier divider, rôles fusionnés, tronqué par le début.
 * Les messages de `deferIds` (messages utilisateur en attente) sont placés en fin de contexte.
 * Les notes d'annulation (`meta.undoneAction`) en sont exclues.
 */
export function contextMessages(
  db: Db,
  {
    maxMessages = 40,
    maxChars = 30000,
    deferIds = [],
  }: { maxMessages?: number; maxChars?: number; deferIds?: number[] } = {},
): { role: "user" | "assistant"; content: string }[] {
  const lastDivider = db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.role, "divider"))
    .orderBy(desc(messages.id))
    .limit(1)
    .get();
  const rows = db
    .select()
    .from(messages)
    .where(lastDivider ? gt(messages.id, lastDivider.id) : undefined)
    .orderBy(asc(messages.id))
    .all();
  if (deferIds.length) {
    const deferred = new Set(deferIds);
    rows.sort((a, b) => Number(deferred.has(a.id)) - Number(deferred.has(b.id)) || a.id - b.id);
  }

  const merged: { role: "user" | "assistant"; content: string }[] = [];
  for (const r of rows) {
    if ((r.role !== "user" && r.role !== "assistant") || !r.content.trim()) continue;
    // Notes « Action annulée : … » : affichage seulement, hors contexte (libellés bancaires).
    if (r.role === "assistant" && r.meta && toMessage(r).meta?.undoneAction !== undefined) continue;
    const last = merged[merged.length - 1];
    if (last && last.role === r.role) last.content += "\n\n" + r.content;
    else merged.push({ role: r.role, content: r.content });
  }
  if (!merged.length) return [];

  // Le dernier élément est toujours conservé (tronqué par le début si trop long) ;
  // les limites s'appliquent aux éléments plus anciens.
  const tail = merged[merged.length - 1];
  if (tail.content.length > maxChars) tail.content = tail.content.slice(-maxChars);
  let kept = 1;
  let chars = tail.content.length;
  for (let i = merged.length - 2; i >= 0; i--) {
    if (kept >= maxMessages || chars + merged[i].content.length > maxChars) break;
    chars += merged[i].content.length;
    kept++;
  }
  const result = merged.slice(merged.length - kept);
  while (result.length && result[0].role !== "user") result.shift();
  return result;
}

/**
 * Messages utilisateur (depuis le dernier divider) pas encore traités par une réponse `chat` :
 * ceux dont l'id dépasse le `meta.replyTo` de la dernière réponse (à défaut, son id).
 */
export function pendingUserMessages(db: Db): Message[] {
  const lastDivider = db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.role, "divider"))
    .orderBy(desc(messages.id))
    .limit(1)
    .get();
  const lastReplyRow = db
    .select()
    .from(messages)
    .where(and(eq(messages.role, "assistant"), eq(messages.kind, "chat")))
    .orderBy(desc(messages.id))
    .limit(1)
    .get();
  let answered = lastDivider?.id ?? 0;
  if (lastReplyRow) {
    const replyTo = toMessage(lastReplyRow).meta?.replyTo;
    answered = Math.max(answered, typeof replyTo === "number" ? replyTo : lastReplyRow.id);
  }
  return db
    .select()
    .from(messages)
    .where(and(eq(messages.role, "user"), gt(messages.id, answered)))
    .orderBy(asc(messages.id))
    .all()
    .map(toMessage)
    .filter((m) => m.content.trim() !== "");
}

/** Dernier message proactif de Claude (alerte ou bilan), ou null (carte du tableau de bord). */
export function latestProactive(db: Db): Message | null {
  const row = db
    .select()
    .from(messages)
    .where(and(eq(messages.role, "assistant"), inArray(messages.kind, ["alert", "weekly", "monthly"])))
    .orderBy(desc(messages.id))
    .limit(1)
    .get();
  return row ? toMessage(row) : null;
}
