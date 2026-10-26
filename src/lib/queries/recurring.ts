import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { accounts, categories, recurring, recurringPayments } from "@/lib/db/schema";
import { BadRequestError, ConflictError, NotFoundError } from "@/lib/api";
import { createTransaction, deleteTransaction, type Transaction } from "@/lib/queries/transactions";
import type { RecurringInput } from "@/lib/validation";

export type Recurring = typeof recurring.$inferSelect;

/** Toutes les dépenses récurrentes (pausées comprises), dans l'ordre de création. */
export function listRecurring(db: Db): Recurring[] {
  return db.select().from(recurring).orderBy(recurring.id).all();
}

function assertCategoryAndAccount(db: Db, categoryId: number | null | undefined, accountId: number | undefined): void {
  if (categoryId !== null && categoryId !== undefined) {
    const cat = db.select().from(categories).where(eq(categories.id, categoryId)).get();
    if (!cat || cat.kind !== "expense") throw new BadRequestError("Catégorie de dépense introuvable.");
  }
  if (accountId !== undefined && !db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId)).get()) {
    throw new BadRequestError("Compte introuvable.");
  }
}

export function createRecurring(db: Db, input: RecurringInput): Recurring {
  assertCategoryAndAccount(db, input.categoryId, input.accountId);
  return db.insert(recurring).values(input).returning().get();
}

/** Modifie une récurrente ; la cohérence fréquence / mois de référence est revérifiée sur l'état fusionné. */
export function updateRecurring(db: Db, id: number, patch: Partial<RecurringInput>): Recurring {
  return db.transaction((tx) => {
    const current = tx.select().from(recurring).where(eq(recurring.id, id)).get();
    if (!current) throw new NotFoundError();
    const merged = { ...current, ...patch };
    if ((merged.frequency === "monthly") !== (merged.anchorMonth === null)) {
      throw new BadRequestError("Le mois de référence est requis sauf pour une récurrente mensuelle");
    }
    assertCategoryAndAccount(tx as unknown as Db, patch.categoryId, patch.accountId);
    if (Object.keys(patch).length === 0) return current;
    return tx.update(recurring).set(patch).where(eq(recurring.id, id)).returning().get()!;
  });
}

export function deleteRecurring(db: Db, id: number): void {
  const deleted = db.delete(recurring).where(eq(recurring.id, id)).returning({ id: recurring.id }).all();
  if (deleted.length === 0) throw new NotFoundError();
}

function requireRecurring(tx: Pick<Db, "select">, id: number): Recurring {
  const r = tx.select().from(recurring).where(eq(recurring.id, id)).get();
  if (!r) throw new NotFoundError();
  return r;
}

function assertPeriodFree(tx: Pick<Db, "select">, id: number, period: string): void {
  const existing = tx
    .select({ id: recurringPayments.recurringId })
    .from(recurringPayments)
    .where(and(eq(recurringPayments.recurringId, id), eq(recurringPayments.period, period)))
    .get();
  if (existing) throw new ConflictError("Déjà validée pour ce mois.");
}

/** Valide une récurrente pour `period` : crée la dépense (montant négatif) et le paiement, en une transaction SQL. */
export function payRecurring(
  db: Db,
  id: number,
  input: { period: string; amount: number; date: string; accountId: number },
): Transaction {
  return db.transaction((tx) => {
    const r = requireRecurring(tx, id);
    assertPeriodFree(tx, id, input.period);
    const account = tx.select().from(accounts).where(eq(accounts.id, input.accountId)).get();
    if (!account) throw new BadRequestError("Compte introuvable.");
    if (account.archived) throw new BadRequestError("Ce compte est archivé.");
    const created = createTransaction(tx, {
      accountId: input.accountId,
      categoryId: r.categoryId,
      date: input.date,
      amount: -input.amount,
      label: r.label,
    });
    tx.insert(recurringPayments).values({ recurringId: id, period: input.period, transactionId: created.id }).run();
    return created;
  });
}

/** Passe le mois : la récurrente n'est ni payée ni comptée dans la prévision. */
export function skipRecurring(db: Db, id: number, period: string): void {
  db.transaction((tx) => {
    requireRecurring(tx, id);
    assertPeriodFree(tx, id, period);
    tx.insert(recurringPayments).values({ recurringId: id, period, transactionId: null, skipped: true }).run();
  });
}

/** Annule un paiement ou un saut ; supprime l'opération liée (la ligne part en cascade). 404 si rien à annuler. */
export function undoPayment(db: Db, id: number, period: string): void {
  db.transaction((tx) => {
    const where = and(eq(recurringPayments.recurringId, id), eq(recurringPayments.period, period));
    const payment = tx.select().from(recurringPayments).where(where).get();
    if (!payment) throw new NotFoundError();
    if (payment.transactionId !== null) deleteTransaction(tx as unknown as Db, payment.transactionId);
    tx.delete(recurringPayments).where(where).run();
  });
}
