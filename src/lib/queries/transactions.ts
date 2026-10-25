import { and, desc, eq, gte, lt, lte, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { accounts, categories, transactions } from "@/lib/db/schema";
import { NotFoundError } from "@/lib/api";
import { monthRange } from "@/lib/finance";
import type { TransactionInput } from "@/lib/validation";

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;

/** Transaction enrichie de sa catégorie et de son compte (null si sans catégorie). */
export type TransactionRow = Transaction & {
  categoryName: string | null;
  categoryColor: string | null;
  categoryIcon: string | null;
  accountName: string;
};

export type TransactionFilter = {
  month?: string;
  accountId?: number;
  categoryId?: number;
  q?: string;
  limit?: number;
};

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;
const UNCATEGORIZED = { name: "Sans catégorie", color: "#94a3b8" } as const;

/** Échappe les jokers LIKE (`%`, `_`) et le caractère d'échappement. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Transactions les plus récentes d'abord (date puis id décroissants).
 * La recherche `q` porte sur le libellé ; la casse n'est ignorée que pour l'ASCII (limite de SQLite LIKE).
 */
export function listTransactions(db: Db, f: TransactionFilter = {}): TransactionRow[] {
  const conditions: (SQL | undefined)[] = [];
  if (f.month) {
    const { start, end } = monthRange(f.month);
    conditions.push(gte(transactions.date, start), lte(transactions.date, end));
  }
  if (f.accountId !== undefined) conditions.push(eq(transactions.accountId, f.accountId));
  if (f.categoryId !== undefined) conditions.push(eq(transactions.categoryId, f.categoryId));
  if (f.q && f.q.trim() !== "") {
    conditions.push(sql`${transactions.label} like ${`%${escapeLike(f.q.trim())}%`} escape '\\'`);
  }
  const limit = Math.min(Math.max(1, Math.trunc(f.limit ?? DEFAULT_LIMIT)), MAX_LIMIT);
  return db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      categoryId: transactions.categoryId,
      date: transactions.date,
      amount: transactions.amount,
      label: transactions.label,
      note: transactions.note,
      createdAt: transactions.createdAt,
      categoryName: categories.name,
      categoryColor: categories.color,
      categoryIcon: categories.icon,
      accountName: accounts.name,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(and(...conditions))
    .orderBy(desc(transactions.date), desc(transactions.id))
    .limit(limit)
    .all();
}

export function createTransaction(db: Db, input: TransactionInput): Transaction {
  return db.insert(transactions).values(input).returning().get();
}

/** Insère toutes les transactions dans une seule transaction SQL (tout ou rien) ; renvoie leurs ids. */
export function insertTransactions(db: Db, txs: NewTransaction[]): number[] {
  return db.transaction((tx) =>
    txs.map((t) => tx.insert(transactions).values(t).returning({ id: transactions.id }).get()!.id),
  );
}

/** Comme `insertTransactions` ; renvoie le nombre de transactions créées. */
export function createTransactions(db: Db, txs: NewTransaction[]): number {
  return insertTransactions(db, txs).length;
}

export function updateTransaction(db: Db, id: number, patch: Partial<TransactionInput>): Transaction {
  const current = db.select().from(transactions).where(eq(transactions.id, id)).get();
  if (!current) throw new NotFoundError();
  if (Object.keys(patch).length === 0) return current;
  return db.update(transactions).set(patch).where(eq(transactions.id, id)).returning().get()!;
}

export function deleteTransaction(db: Db, id: number): void {
  const deleted = db
    .delete(transactions)
    .where(eq(transactions.id, id))
    .returning({ id: transactions.id })
    .all();
  if (deleted.length === 0) throw new NotFoundError();
}

/** Dépenses (montants < 0) entre deux dates incluses, par catégorie ; `total` en centimes positifs, décroissant. */
export function spendingByCategory(
  db: Db,
  start: string,
  end: string,
): { categoryId: number | null; name: string; color: string; total: number }[] {
  const total = sql<number>`-sum(${transactions.amount})`.mapWith(Number);
  return db
    .select({
      categoryId: transactions.categoryId,
      name: categories.name,
      color: categories.color,
      total,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(and(lt(transactions.amount, 0), gte(transactions.date, start), lte(transactions.date, end)))
    .groupBy(transactions.categoryId)
    .orderBy(desc(total), categories.name)
    .all()
    .map((r) => ({
      categoryId: r.categoryId,
      name: r.name ?? UNCATEGORIZED.name,
      color: r.color ?? UNCATEGORIZED.color,
      total: r.total,
    }));
}

/** Revenus (somme des montants > 0) et dépenses (somme des montants < 0, négative) d'un mois « YYYY-MM ». */
export function monthTotals(db: Db, month: string): { income: number; expenses: number } {
  const { start, end } = monthRange(month);
  const row = db
    .select({
      income: sql<number>`coalesce(sum(case when ${transactions.amount} > 0 then ${transactions.amount} end), 0)`.mapWith(Number),
      expenses: sql<number>`coalesce(sum(case when ${transactions.amount} < 0 then ${transactions.amount} end), 0)`.mapWith(Number),
    })
    .from(transactions)
    .where(and(gte(transactions.date, start), lte(transactions.date, end)))
    .get()!;
  return { income: row.income, expenses: row.expenses };
}
