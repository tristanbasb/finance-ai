import { eq, inArray } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Db } from "@/lib/db";
import { accounts, aiActions, categories, goals, holdings, transactions } from "@/lib/db/schema";

export type ChangeTable = "transactions" | "categories" | "goals" | "accounts" | "holdings";

export type Change = {
  table: ChangeTable;
  id: number;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

const DAY_MS = 24 * 3600 * 1000;

const TABLES = { transactions, categories, goals, accounts, holdings } as const;
const TABLE_LABELS: Record<ChangeTable, string> = {
  transactions: "transaction",
  categories: "catégorie",
  goals: "objectif",
  accounts: "compte",
  holdings: "position",
};

// Les tables ont toutes une colonne `id` ; le typage générique de Drizzle ne le sait pas.
type AnyTable = SQLiteTable & { id: Parameters<typeof eq>[0] };
const tableOf = (name: ChangeTable) => TABLES[name] as unknown as AnyTable;

type Row = Record<string, unknown>;

export function recordAction(db: Db, input: { tool: string; summary: string; changes: Change[] }): number {
  return db
    .insert(aiActions)
    .values({ tool: input.tool, summary: input.summary, changes: JSON.stringify(input.changes) })
    .returning({ id: aiActions.id })
    .get().id;
}

export function attachActionsToMessage(db: Db, actionIds: number[], messageId: number): void {
  if (actionIds.length === 0) return;
  db.update(aiActions).set({ messageId }).where(inArray(aiActions.id, actionIds)).run();
}

function parseChanges(raw: string): Change[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is Change =>
        !!c && typeof c === "object" && typeof c.id === "number" && typeof c.table === "string" && c.table in TABLES,
    );
  } catch {
    return [];
  }
}

/** Libellé lisible d'une ligne, pour expliquer pourquoi l'annulation est refusée. */
function describeRow(change: Change): string {
  const row = change.after ?? change.before ?? {};
  const name = row.label ?? row.name ?? row.symbol;
  const kind = TABLE_LABELS[change.table];
  return typeof name === "string" && name ? `${kind} « ${name} »` : `${kind} n° ${change.id}`;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function currentRow(db: Db, change: Change): Row | undefined {
  const t = tableOf(change.table);
  return db.select().from(t).where(eq(t.id, change.id)).get() as Row | undefined;
}

/** Première modification postérieure détectée parmi les changes, ou null. */
function findConflict(db: Db, changes: Change[]): string | null {
  for (const change of changes) {
    const current = currentRow(db, change);
    if (change.after === null) {
      if (current) return describeRow(change);
      continue;
    }
    if (!current) return describeRow(change);
    for (const key of Object.keys(change.after)) {
      if (!same(change.after[key], current[key])) return describeRow(change);
    }
  }
  return null;
}

export type ActionStatus = {
  undoable: boolean;
  reason?: string;
  summary: string;
  undoneAt: number | null;
  createdAt: number;
  tool: string;
  changes: Change[];
};

export function actionStatus(db: Db, id: number, now = Date.now()): ActionStatus {
  const row = db.select().from(aiActions).where(eq(aiActions.id, id)).get();
  if (!row) {
    return { undoable: false, reason: "Action introuvable.", summary: "", undoneAt: null, createdAt: 0, tool: "", changes: [] };
  }
  const changes = parseChanges(row.changes);
  const base = { summary: row.summary, undoneAt: row.undoneAt, createdAt: row.createdAt, tool: row.tool, changes };
  if (row.undoneAt !== null) return { ...base, undoable: false, reason: "Déjà annulée." };
  if (now - row.createdAt > DAY_MS) return { ...base, undoable: false, reason: "Plus de 24 h : annulation impossible." };
  const conflict = findConflict(db, changes);
  if (conflict) return { ...base, undoable: false, reason: `Modifié depuis : ${conflict}.` };
  return { ...base, undoable: true };
}

export function undoAction(db: Db, id: number, now = Date.now()): { ok: true; summary: string } | { ok: false; reason: string } {
  const status = actionStatus(db, id, now);
  if (!status.undoable) return { ok: false, reason: status.reason ?? "Annulation impossible." };
  try {
    db.transaction((tx) => {
      for (const change of [...status.changes].reverse()) {
        const t = tableOf(change.table);
        if (change.before === null) {
          tx.delete(t).where(eq(t.id, change.id)).run();
        } else if (change.after === null) {
          tx.insert(t).values(change.before as never).run();
        } else {
          tx.update(t).set(change.before as never).where(eq(t.id, change.id)).run();
        }
      }
      tx.update(aiActions).set({ undoneAt: now }).where(eq(aiActions.id, id)).run();
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: `Annulation impossible : ${detail}` };
  }
  return { ok: true, summary: status.summary };
}
