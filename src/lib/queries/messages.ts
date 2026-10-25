import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
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
    })
    .returning()
    .get();
  return toMessage(row);
}

/** Messages en ordre chronologique ; `before` = created_at exclusif, `limit` 50 (max 200). */
export function listMessages(db: Db, opts: { before?: number; limit?: number } = {}): Message[] {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 50), 1), 200);
  const rows = db
    .select()
    .from(messages)
    .where(opts.before === undefined ? undefined : lt(messages.createdAt, opts.before))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(limit)
    .all();
  return rows.reverse().map(toMessage);
}

const unreadWhere = and(
  eq(messages.role, "assistant"),
  isNull(messages.readAt),
);

export function unreadSummary(db: Db): { count: number; latest: Message[] } {
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
  return { count, latest };
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

/** Contexte envoyé à Claude : depuis le dernier divider, rôles fusionnés, tronqué par le début. */
export function contextMessages(
  db: Db,
  { maxMessages = 40, maxChars = 30000 }: { maxMessages?: number; maxChars?: number } = {},
): { role: "user" | "assistant"; content: string }[] {
  const lastDivider = db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.role, "divider"))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(1)
    .get();
  const rows = db
    .select()
    .from(messages)
    .orderBy(asc(messages.createdAt), asc(messages.id))
    .all();
  let start = 0;
  if (lastDivider) start = rows.findIndex((r) => r.id === lastDivider.id) + 1;

  const merged: { role: "user" | "assistant"; content: string }[] = [];
  for (const r of rows.slice(start)) {
    if (r.role !== "user" && r.role !== "assistant") continue;
    const last = merged[merged.length - 1];
    if (last && last.role === r.role) last.content += `\n\n${r.content}`;
    else merged.push({ role: r.role, content: r.content });
  }

  // Troncature par le début : on garde les plus récents sous les deux limites.
  let kept = 0;
  let chars = 0;
  for (let i = merged.length - 1; i >= 0; i--) {
    if (kept >= maxMessages || chars + merged[i].content.length > maxChars) break;
    chars += merged[i].content.length;
    kept++;
  }
  const result = merged.slice(merged.length - kept);
  while (result.length && result[0].role !== "user") result.shift();
  return result;
}
