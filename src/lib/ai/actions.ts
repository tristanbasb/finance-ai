import { eq, inArray } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Db } from "@/lib/db";
import { accounts, aiActions, categories, goals, holdings, transactions } from "@/lib/db/schema";
import { formatDateFull } from "@/lib/format";
import { formatEUR } from "@/lib/money";

export type ChangeTable = "transactions" | "categories" | "goals" | "accounts" | "holdings";

export type Change = {
  table: ChangeTable;
  id: number;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

const DAY_MS = 24 * 3600 * 1000;

/** Raison renvoyée pour un id absent du journal (404 côté API). */
export const ACTION_NOT_FOUND = "Action introuvable.";
export const UNDO_FAILED = "Annulation impossible : les données ont changé depuis.";

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

const isObj = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);

/** Lecture stricte du journal ; null si illisible. */
function parseChanges(raw: string): Change[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    for (const c of parsed) {
      if (!isObj(c)) return null;
      if (typeof c.table !== "string" || !Object.hasOwn(TABLES, c.table)) return null;
      if (!Number.isInteger(c.id) || (c.id as number) <= 0) return null;
      for (const k of ["before", "after"]) {
        if (!(k in c) || (c[k] !== null && !isObj(c[k]))) return null;
      }
    }
    return parsed as Change[];
  } catch {
    return null;
  }
}

/** Fusionne les changes par ligne : premier `before`, dernier `after` ; création puis suppression = rien. */
function netChanges(changes: Change[]): Change[] {
  const map = new Map<string, Change>();
  for (const c of changes) {
    const key = `${c.table}:${c.id}`;
    const prev = map.get(key);
    map.set(key, prev ? { ...prev, after: c.after } : { ...c });
  }
  return [...map.values()].filter((c) => c.before !== null || c.after !== null);
}

/** Libellé lisible d'une ligne, pour expliquer pourquoi l'annulation est refusée. */
function describeRow(change: Change): string {
  const row = change.after ?? change.before ?? {};
  const name = row.label ?? row.name ?? row.symbol;
  const kind = TABLE_LABELS[change.table];
  return typeof name === "string" && name ? `${kind} « ${name} »` : `${kind} n° ${change.id}`;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function currentRow(db: Db, table: ChangeTable, id: number): Row | undefined {
  const t = tableOf(table);
  return db.select().from(t).where(eq(t.id, id)).get() as Row | undefined;
}

/** Une ligne créée par l'action a-t-elle des dépendants extérieurs à l'action (ON DELETE SET NULL) ? */
function hasForeignDependents(db: Db, change: Change, net: Change[]): boolean {
  const own = (table: ChangeTable) => new Set(net.filter((c) => c.table === table).map((c) => c.id));
  const outside = (rows: { id: number }[], table: ChangeTable) => {
    const mine = own(table);
    return rows.some((r) => !mine.has(r.id));
  };
  if (change.table === "categories") {
    const rows = db.select({ id: transactions.id }).from(transactions).where(eq(transactions.categoryId, change.id)).all();
    return outside(rows, "transactions");
  }
  if (change.table === "accounts") {
    return (
      outside(db.select({ id: transactions.id }).from(transactions).where(eq(transactions.accountId, change.id)).all(), "transactions") ||
      outside(db.select({ id: holdings.id }).from(holdings).where(eq(holdings.accountId, change.id)).all(), "holdings") ||
      outside(db.select({ id: goals.id }).from(goals).where(eq(goals.accountId, change.id)).all(), "goals")
    );
  }
  return false;
}

/** La ligne existera-t-elle (déjà présente ou restaurée par cette annulation) ? */
function willExist(db: Db, table: ChangeTable, id: number, net: Change[]): boolean {
  const c = net.find((x) => x.table === table && x.id === id);
  if (c) return c.before !== null;
  return currentRow(db, table, id) !== undefined;
}

function missingReference(db: Db, change: Change, net: Change[]): boolean {
  const b = change.before;
  if (!b) return false;
  const refs: [ChangeTable, unknown][] = [];
  if (change.table === "transactions") refs.push(["accounts", b.accountId], ["categories", b.categoryId]);
  if (change.table === "holdings" || change.table === "goals") refs.push(["accounts", b.accountId]);
  return refs.some(([t, id]) => typeof id === "number" && !willExist(db, t, id, net));
}

/** Première raison de refus parmi les changes nets, ou null. */
function findConflict(db: Db, net: Change[]): string | null {
  for (const change of net) {
    const current = currentRow(db, change.table, change.id);
    if (change.after === null) {
      if (current) return `${describeRow(change)}.`;
    } else {
      if (!current) return `${describeRow(change)}.`;
      for (const key of Object.keys(change.after)) {
        if (!same(change.after[key], current[key])) return `${describeRow(change)}.`;
      }
      if (change.before === null && hasForeignDependents(db, change, net)) {
        return `${describeRow(change)} est utilisé par d'autres éléments.`;
      }
    }
    if (missingReference(db, change, net)) return "le compte ou la catégorie liée n'existe plus.";
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
    return { undoable: false, reason: ACTION_NOT_FOUND, summary: "", undoneAt: null, createdAt: 0, tool: "", changes: [] };
  }
  const parsed = parseChanges(row.changes);
  const changes = parsed ?? [];
  const base = { summary: row.summary, undoneAt: row.undoneAt, createdAt: row.createdAt, tool: row.tool, changes };
  if (row.undoneAt !== null) return { ...base, undoable: false, reason: "Déjà annulée." };
  if (now - row.createdAt > DAY_MS) return { ...base, undoable: false, reason: "Plus de 24 h : annulation impossible." };
  if (parsed === null) return { ...base, undoable: false, reason: "Journal illisible : annulation impossible." };
  const conflict = findConflict(db, netChanges(changes));
  if (conflict) return { ...base, undoable: false, reason: `Modifié depuis : ${conflict}` };
  return { ...base, undoable: true };
}

export function undoAction(db: Db, id: number, now = Date.now()): { ok: true; summary: string } | { ok: false; reason: string } {
  const status = actionStatus(db, id, now);
  if (!status.undoable) return { ok: false, reason: status.reason ?? "Annulation impossible." };
  try {
    db.transaction((tx) => {
      for (const change of netChanges(status.changes).reverse()) {
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
    // Détail SQLite journalisé côté serveur seulement ; raison générique pour l'utilisateur.
    console.error(`[ai] échec de l'annulation de l'action ${id} :`, e);
    return { ok: false, reason: UNDO_FAILED };
  }
  return { ok: true, summary: status.summary };
}

// ---------------------------------------------------------------------------
// Détail lisible (carte « Fait » repliable dans l'interface)

const ITEM_NOUNS: Record<ChangeTable, { noun: string; feminine: boolean }> = {
  transactions: { noun: "Opération", feminine: true },
  categories: { noun: "Catégorie", feminine: true },
  goals: { noun: "Objectif", feminine: false },
  accounts: { noun: "Compte", feminine: false },
  holdings: { noun: "Position", feminine: true },
};

export const MAX_ACTION_ITEMS = 20;

function itemLine(c: Change): string {
  const { noun, feminine } = ITEM_NOUNS[c.table];
  const row = c.after ?? c.before ?? {};
  const name = row.label ?? row.name ?? row.symbol;
  let line = typeof name === "string" && name ? `${noun} « ${name} »` : `${noun} n° ${c.id}`;
  if (c.table === "transactions" && typeof row.amount === "number" && typeof row.date === "string") {
    const sign = row.amount < 0 ? "\u2212" : "+";
    line += ` (${sign}${formatEUR(Math.abs(row.amount))}, ${formatDateFull(row.date)})`;
  }
  const verb = c.before === null ? "ajouté" : c.after === null ? "supprimé" : "modifié";
  return `${line} : ${verb}${feminine ? "e" : ""}`;
}

/**
 * Une ligne lisible par élément touché (« Opération « Pain » (−12,00 €, 26 octobre 2026) :
 * ajoutée »), au plus 20, puis « … et N autres éléments ». Pur.
 */
export function actionItems(changes: Change[]): string[] {
  const lines = changes.slice(0, MAX_ACTION_ITEMS).map(itemLine);
  const rest = changes.length - MAX_ACTION_ITEMS;
  if (rest > 0) lines.push(`… et ${rest} autre${rest > 1 ? "s" : ""} élément${rest > 1 ? "s" : ""}`);
  return lines;
}

/** Vue d'une action pour l'interface (`GET /api/ai/actions`). */
export type ActionView = {
  id: number;
  tool: string;
  summary: string;
  createdAt: number;
  undoneAt: number | null;
  undoable: boolean;
  reason?: string;
  items: string[];
};

/** Vues des actions demandées, dans l'ordre des ids ; les ids inconnus sont omis. */
export function actionViews(db: Db, ids: number[], now = Date.now()): ActionView[] {
  const views: ActionView[] = [];
  for (const id of ids) {
    const s = actionStatus(db, id, now);
    if (s.reason === ACTION_NOT_FOUND) continue;
    views.push({
      id,
      tool: s.tool,
      summary: s.summary,
      createdAt: s.createdAt,
      undoneAt: s.undoneAt,
      undoable: s.undoable,
      ...(s.reason !== undefined ? { reason: s.reason } : {}),
      items: actionItems(s.changes),
    });
  }
  return views;
}
