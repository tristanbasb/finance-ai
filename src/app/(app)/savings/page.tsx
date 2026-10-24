import type { Metadata } from "next";
import { getDb } from "@/lib/db";
import { todayLocal } from "@/lib/dates";
import { listAccountsWithBalances } from "@/lib/queries/accounts";
import { listGoals } from "@/lib/queries/goals";
import type { GoalView } from "@/components/savings/goal-dialog";
import { SavingsView } from "@/components/savings/savings-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Épargne" };

export default function SavingsPage() {
  const db = getDb();
  const accounts = listAccountsWithBalances(db);
  const balances = new Map(accounts.map((a) => [a.id, a.balance]));

  // Un objectif rattaché à un compte reprend le solde de ce compte ; sinon le montant saisi.
  const goals: GoalView[] = listGoals(db).map((g) => ({
    id: g.id,
    name: g.name,
    targetAmount: g.targetAmount,
    accountId: g.accountId,
    currentAmount: g.currentAmount,
    deadline: g.deadline,
    color: g.color,
    current: g.accountId !== null && balances.has(g.accountId) ? balances.get(g.accountId)! : g.currentAmount,
  }));

  return (
    <SavingsView
      savingsAccounts={accounts
        .filter((a) => a.type === "savings" && !a.archived)
        .map((a) => ({ id: a.id, name: a.name, color: a.color, balance: a.balance }))}
      goalAccounts={accounts
        .filter((a) => a.type === "savings" || a.type === "checking" || a.type === "other")
        .map((a) => ({ id: a.id, name: a.name, archived: a.archived, balance: a.balance }))}
      goals={goals}
      today={todayLocal()}
    />
  );
}
