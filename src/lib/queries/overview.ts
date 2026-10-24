import { and, eq, gte, isNotNull, lt, lte, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { categories, transactions } from "@/lib/db/schema";
import { budgetStatus, monthRange, savingsRate } from "@/lib/finance";
import { listAccountsWithBalances } from "./accounts";
import { listTransactions, monthTotals, type TransactionRow } from "./transactions";

export type BudgetLine = {
  categoryId: number;
  name: string;
  color: string;
  icon: string;
  /** Budget mensuel (centimes). */
  budget: number;
  /** Dépensé dans le mois, en centimes positifs. */
  spent: number;
  status: NonNullable<ReturnType<typeof budgetStatus>>;
};

export type Overview = {
  netWorth: number;
  /** Somme des soldes des comptes non archivés. */
  cash: number;
  /** Valeur des positions des comptes non archivés. */
  investments: number;
  /** Totaux du mois de `today` : revenus >= 0, dépenses <= 0. */
  month: { income: number; expenses: number };
  savingsRate: number;
  budgets: BudgetLine[];
  /** 5 dernières transactions. */
  recent: TransactionRow[];
};

/** Tableau de bord ; `today` au format YYYY-MM-DD (le mois courant en est déduit). */
export function getOverview(db: Db, today: string): Overview {
  const month = today.slice(0, 7);
  const { start, end } = monthRange(month);

  const active = listAccountsWithBalances(db).filter((a) => !a.archived);
  const cash = active.reduce((sum, a) => sum + a.balance, 0);
  const investments = active.reduce((sum, a) => sum + a.investmentsValue, 0);

  const totals = monthTotals(db, month);

  const spentExpr = sql<number>`coalesce(-sum(${transactions.amount}), 0)`.mapWith(Number);
  const budgets = db
    .select({
      categoryId: categories.id,
      name: categories.name,
      color: categories.color,
      icon: categories.icon,
      budget: categories.monthlyBudget,
      spent: spentExpr,
    })
    .from(categories)
    .leftJoin(
      transactions,
      and(
        eq(transactions.categoryId, categories.id),
        lt(transactions.amount, 0),
        gte(transactions.date, start),
        lte(transactions.date, end),
      ),
    )
    .where(and(eq(categories.kind, "expense"), isNotNull(categories.monthlyBudget)))
    .groupBy(categories.id)
    .orderBy(categories.id)
    .all()
    .map((r): BudgetLine => {
      const budget = r.budget as number; // non nul grâce au filtre
      return { ...r, budget, status: budgetStatus(r.spent, budget)! };
    });

  return {
    netWorth: cash + investments,
    cash,
    investments,
    month: totals,
    savingsRate: savingsRate(totals.income, totals.expenses),
    budgets,
    recent: listTransactions(db, { limit: 5 }),
  };
}
