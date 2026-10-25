import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { goals } from "@/lib/db/schema";
import { NotFoundError } from "@/lib/api";
import { listAccountsWithBalances } from "./accounts";
import type { GoalInput } from "@/lib/validation";

export type Goal = typeof goals.$inferSelect;

export function listGoals(db: Db): Goal[] {
  return db.select().from(goals).orderBy(goals.id).all();
}

/**
 * Objectifs avec leur montant actuel : un objectif rattaché à un compte suit le solde de ce
 * compte (comme la page Épargne), sinon `currentAmount`.
 */
export function listGoalsWithCurrent(db: Db): (Goal & { current: number })[] {
  const balances = new Map(listAccountsWithBalances(db).map((a) => [a.id, a.balance]));
  return listGoals(db).map((g) => ({
    ...g,
    current: g.accountId !== null && balances.has(g.accountId) ? balances.get(g.accountId)! : g.currentAmount,
  }));
}

export function createGoal(db: Db, input: GoalInput): Goal {
  return db.insert(goals).values(input).returning().get();
}

export function updateGoal(db: Db, id: number, patch: Partial<GoalInput>): Goal {
  const current = db.select().from(goals).where(eq(goals.id, id)).get();
  if (!current) throw new NotFoundError();
  if (Object.keys(patch).length === 0) return current;
  return db.update(goals).set(patch).where(eq(goals.id, id)).returning().get()!;
}

export function deleteGoal(db: Db, id: number): void {
  const deleted = db.delete(goals).where(eq(goals.id, id)).returning({ id: goals.id }).all();
  if (deleted.length === 0) throw new NotFoundError();
}
