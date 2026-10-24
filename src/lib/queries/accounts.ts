import { count, eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { accounts, holdings, transactions } from "@/lib/db/schema";
import { ConflictError, NotFoundError } from "@/lib/api";
import { accountBalance } from "@/lib/finance";
import type { AccountInput } from "@/lib/validation";
import { listHoldingsWithValues } from "./holdings";

export type Account = typeof accounts.$inferSelect;

export type AccountWithBalance = Account & {
  /** Solde initial + somme des transactions (centimes). */
  balance: number;
  /** Valeur des positions rattachées au compte (centimes). */
  investmentsValue: number;
  total: number;
};

/** Tous les comptes (archivés inclus, signalés par `archived`) avec soldes et valeur des positions. */
export function listAccountsWithBalances(db: Db): AccountWithBalance[] {
  const sums = new Map(
    db
      .select({
        accountId: transactions.accountId,
        sum: sql<number>`coalesce(sum(${transactions.amount}), 0)`.mapWith(Number),
      })
      .from(transactions)
      .groupBy(transactions.accountId)
      .all()
      .map((r) => [r.accountId, r.sum]),
  );
  const investments = new Map<number, number>();
  for (const h of listHoldingsWithValues(db)) {
    investments.set(h.accountId, (investments.get(h.accountId) ?? 0) + h.value);
  }
  return db
    .select()
    .from(accounts)
    .orderBy(accounts.id)
    .all()
    .map((a) => {
      const balance = accountBalance(a.initialBalance, [sums.get(a.id) ?? 0]);
      const investmentsValue = investments.get(a.id) ?? 0;
      return { ...a, balance, investmentsValue, total: balance + investmentsValue };
    });
}

export function createAccount(db: Db, input: AccountInput): Account {
  return db.insert(accounts).values(input).returning().get();
}

export function updateAccount(db: Db, id: number, patch: Partial<AccountInput>): Account {
  const current = db.select().from(accounts).where(eq(accounts.id, id)).get();
  if (!current) throw new NotFoundError();
  if (Object.keys(patch).length === 0) return current;
  return db.update(accounts).set(patch).where(eq(accounts.id, id)).returning().get()!;
}

/** Supprime un compte vide ; refuse s'il a des transactions ou des positions (à archiver plutôt). */
export function deleteAccount(db: Db, id: number): void {
  db.transaction((tx) => {
    if (!tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, id)).get()) {
      throw new NotFoundError();
    }
    const txCount = tx.select({ n: count() }).from(transactions).where(eq(transactions.accountId, id)).get()!.n;
    const holdingCount = tx.select({ n: count() }).from(holdings).where(eq(holdings.accountId, id)).get()!.n;
    if (txCount > 0 || holdingCount > 0) {
      throw new ConflictError("Ce compte contient des données, archivez-le plutôt.");
    }
    tx.delete(accounts).where(eq(accounts.id, id)).run();
  });
}
