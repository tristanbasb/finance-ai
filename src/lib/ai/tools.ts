import type Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, gte, isNull, lt, lte, gt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db";
import { accounts, categories, transactions } from "@/lib/db/schema";
import { todayLocal } from "@/lib/dates";
import { goalProgress, monthRange } from "@/lib/finance";
import { listAccountsWithBalances } from "@/lib/queries/accounts";
import { listCategories } from "@/lib/queries/categories";
import { listGoals } from "@/lib/queries/goals";
import { listHoldingsWithValues } from "@/lib/queries/holdings";
import { getOverview } from "@/lib/queries/overview";
import { spendingByCategory } from "@/lib/queries/transactions";
import { isoDate, monthString } from "@/lib/validation";

// Outils en lecture seule exposés à Claude. Montants renvoyés en euros (2 décimales),
// dates au format YYYY-MM-DD. Aucun outil n'écrit en base.

/** Centimes entiers → euros. */
const eur = (cents: number) => Math.round(cents) / 100;
/** Prix unitaire réel en centimes → euros (6 décimales, pour les petites cryptos). */
const unitEur = (cents: number) => Math.round(cents * 10_000) / 1_000_000;
const pct = (fraction: number) => Math.round(fraction * 1000) / 10;

const UNCATEGORIZED = "Sans catégorie";

const period = z
  .object({ month: monthString.optional(), start_date: isoDate.optional(), end_date: isoDate.optional() })
  .strict();

const searchInput = z
  .object({
    month: monthString.optional(),
    start_date: isoDate.optional(),
    end_date: isoDate.optional(),
    category: z.union([z.string().trim().min(1).max(100), z.number().int().positive()]).optional(),
    q: z.string().trim().max(200).optional(),
    kind: z.enum(["expense", "income"]).optional(),
    min_amount: z.number().nonnegative().optional(),
    max_amount: z.number().nonnegative().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .strict();

const noInput = z.object({}).strict();

const DATE = { type: "string", description: "Date YYYY-MM-DD." } as const;
const MONTH = { type: "string", description: "Mois YYYY-MM." } as const;

export const aiTools: Anthropic.Tool[] = [
  {
    name: "get_overview",
    description:
      "Vue d'ensemble actuelle : patrimoine net, liquidités, investissements, soldes des comptes, " +
      "revenus/dépenses et taux d'épargne du mois en cours, budgets mensuels et consommation. Montants en euros.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "search_transactions",
    description:
      "Recherche des transactions (plus récentes d'abord). Tous les filtres sont optionnels et cumulables. " +
      "Renvoie le nombre total et la somme des transactions correspondantes (même au-delà de `limit`), puis la liste. " +
      "Montants signés en euros : dépenses négatives, revenus positifs.",
    input_schema: {
      type: "object",
      properties: {
        month: MONTH,
        start_date: { ...DATE, description: "Date de début incluse (YYYY-MM-DD)." },
        end_date: { ...DATE, description: "Date de fin incluse (YYYY-MM-DD)." },
        category: {
          anyOf: [{ type: "string" }, { type: "integer" }],
          description: `Nom (insensible à la casse) ou id de catégorie ; « ${UNCATEGORIZED} » pour les transactions non catégorisées.`,
        },
        q: { type: "string", description: "Texte recherché dans le libellé ou la note." },
        kind: { type: "string", enum: ["expense", "income"], description: "Dépenses ou revenus uniquement." },
        min_amount: { type: "number", description: "Montant minimal en euros, en valeur absolue." },
        max_amount: { type: "number", description: "Montant maximal en euros, en valeur absolue." },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "Nombre maximal de lignes (défaut 50)." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "spending_by_category",
    description:
      "Dépenses par catégorie sur une période (un mois, ou start_date/end_date ; défaut : mois en cours), " +
      "avec la part de chaque catégorie, le total des revenus et, pour un mois, le budget mensuel. Montants en euros positifs.",
    input_schema: {
      type: "object",
      properties: {
        month: MONTH,
        start_date: { ...DATE, description: "Date de début incluse." },
        end_date: { ...DATE, description: "Date de fin incluse." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_holdings",
    description:
      "Positions d'investissement (actions, ETF, cryptos, actifs manuels) : quantité, prix unitaire retenu, " +
      "prix de revient moyen, valeur, plus-value latente et totaux. Montants en euros.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_goals",
    description:
      "Objectifs d'épargne : cible, montant actuel, reste à épargner, avancement, échéance et effort mensuel nécessaire. Montants en euros.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
];

function firstIssue(err: z.ZodError): string {
  const issue = err.issues[0];
  const path = issue?.path.join(".");
  return `Paramètres invalides${path ? ` (${path})` : ""} : ${issue?.message ?? "entrée refusée"}`;
}

function resolvePeriod(input: z.infer<typeof period>, today: string): { start: string; end: string; month?: string } {
  if (input.month) return { ...monthRange(input.month), month: input.month };
  if (input.start_date || input.end_date) {
    return { start: input.start_date ?? "0000-01-01", end: input.end_date ?? "9999-12-31" };
  }
  const month = today.slice(0, 7);
  return { ...monthRange(month), month };
}

function getOverviewTool(db: Db, today: string) {
  const o = getOverview(db, today);
  return {
    currency: "EUR",
    date: today,
    net_worth: eur(o.netWorth),
    cash: eur(o.cash),
    investments: eur(o.investments),
    accounts: listAccountsWithBalances(db)
      .filter((a) => !a.archived)
      .map((a) => ({ name: a.name, type: a.type, balance: eur(a.balance), investments: eur(a.investmentsValue) })),
    current_month: {
      month: today.slice(0, 7),
      income: eur(o.month.income),
      expenses: eur(o.month.expenses),
      net: eur(o.month.income + o.month.expenses),
      savings_rate_pct: pct(o.savingsRate),
    },
    budgets: o.budgets.map((b) => ({
      category: b.name,
      budget: eur(b.budget),
      spent: eur(b.spent),
      used_pct: pct(b.status.pct),
      status: b.status.level,
    })),
  };
}

function searchTransactionsTool(db: Db, input: z.infer<typeof searchInput>) {
  const conditions: (SQL | undefined)[] = [];
  if (input.month) {
    const { start, end } = monthRange(input.month);
    conditions.push(gte(transactions.date, start), lte(transactions.date, end));
  }
  if (input.start_date) conditions.push(gte(transactions.date, input.start_date));
  if (input.end_date) conditions.push(lte(transactions.date, input.end_date));

  if (input.category !== undefined) {
    const all = listCategories(db);
    const wanted = typeof input.category === "string" ? input.category.toLocaleLowerCase("fr") : null;
    if (wanted === UNCATEGORIZED.toLocaleLowerCase("fr")) {
      conditions.push(isNull(transactions.categoryId));
    } else {
      const match = all.find((c) =>
        wanted === null ? c.id === input.category : c.name.toLocaleLowerCase("fr") === wanted,
      );
      if (!match) {
        return {
          error: `Catégorie inconnue : ${String(input.category)}`,
          available_categories: [...all.map((c) => c.name), UNCATEGORIZED],
        };
      }
      conditions.push(eq(transactions.categoryId, match.id));
    }
  }

  if (input.q) {
    const like = `%${input.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conditions.push(
      or(
        sql`${transactions.label} like ${like} escape '\\'`,
        sql`coalesce(${transactions.note}, '') like ${like} escape '\\'`,
      ),
    );
  }
  if (input.kind === "expense") conditions.push(lt(transactions.amount, 0));
  if (input.kind === "income") conditions.push(gt(transactions.amount, 0));
  if (input.min_amount !== undefined) {
    conditions.push(sql`abs(${transactions.amount}) >= ${Math.round(input.min_amount * 100)}`);
  }
  if (input.max_amount !== undefined) {
    conditions.push(sql`abs(${transactions.amount}) <= ${Math.round(input.max_amount * 100)}`);
  }

  const where = and(...conditions);
  const totals = db
    .select({
      count: sql<number>`count(*)`.mapWith(Number),
      total: sql<number>`coalesce(sum(${transactions.amount}), 0)`.mapWith(Number),
    })
    .from(transactions)
    .where(where)
    .get()!;

  const limit = input.limit ?? 50;
  const rows = db
    .select({
      date: transactions.date,
      label: transactions.label,
      amount: transactions.amount,
      note: transactions.note,
      category: categories.name,
      account: accounts.name,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(where)
    .orderBy(desc(transactions.date), desc(transactions.id))
    .limit(limit)
    .all();

  return {
    currency: "EUR",
    count: totals.count,
    total: eur(totals.total),
    truncated: totals.count > rows.length,
    transactions: rows.map((r) => ({
      date: r.date,
      label: r.label,
      amount: eur(r.amount),
      category: r.category ?? UNCATEGORIZED,
      account: r.account,
      ...(r.note ? { note: r.note } : {}),
    })),
  };
}

function spendingByCategoryTool(db: Db, input: z.infer<typeof period>, today: string) {
  const { start, end, month } = resolvePeriod(input, today);
  if (start > end) return { error: "La date de début est postérieure à la date de fin." };
  const rows = spendingByCategory(db, start, end);
  const totalExpenses = rows.reduce((s, r) => s + r.total, 0);
  const income = db
    .select({ v: sql<number>`coalesce(sum(${transactions.amount}), 0)`.mapWith(Number) })
    .from(transactions)
    .where(and(gt(transactions.amount, 0), gte(transactions.date, start), lte(transactions.date, end)))
    .get()!.v;
  const budgets = new Map(listCategories(db).map((c) => [c.id, c.monthlyBudget]));
  return {
    currency: "EUR",
    period: { start, end },
    total_expenses: eur(totalExpenses),
    total_income: eur(income),
    categories: rows.map((r) => {
      const budget = month && r.categoryId !== null ? budgets.get(r.categoryId) : null;
      return {
        category: r.name,
        amount: eur(r.total),
        share_pct: totalExpenses > 0 ? pct(r.total / totalExpenses) : 0,
        ...(budget != null ? { budget: eur(budget) } : {}),
      };
    }),
  };
}

function getHoldingsTool(db: Db) {
  const accountNames = new Map(listAccountsWithBalances(db).map((a) => [a.id, a.name]));
  const list = listHoldingsWithValues(db);
  const value = list.reduce((s, h) => s + h.value, 0);
  const cost = list.reduce((s, h) => s + h.cost, 0);
  return {
    currency: "EUR",
    total_value: eur(value),
    total_cost: eur(cost),
    total_pnl: eur(value - cost),
    total_pnl_pct: cost === 0 ? 0 : pct((value - cost) / cost),
    holdings: list.map((h) => ({
      symbol: h.symbol,
      name: h.name,
      type: h.assetType,
      account: accountNames.get(h.accountId) ?? null,
      quantity: h.quantity,
      unit_price: unitEur(h.price),
      price_source: h.priceSource,
      avg_price: unitEur(h.avgPrice),
      value: eur(h.value),
      cost: eur(h.cost),
      pnl: eur(h.pnl),
      pnl_pct: pct(h.pnlPct),
    })),
  };
}

function getGoalsTool(db: Db, today: string) {
  const accountsById = new Map(listAccountsWithBalances(db).map((a) => [a.id, a]));
  return {
    currency: "EUR",
    date: today,
    goals: listGoals(db).map((g) => {
      const account = g.accountId !== null ? accountsById.get(g.accountId) : undefined;
      // Un objectif rattaché à un compte suit le solde de ce compte (comme la page Épargne).
      const current = account ? account.balance : g.currentAmount;
      const p = goalProgress({ target: g.targetAmount, current, deadline: g.deadline }, today);
      return {
        name: g.name,
        target: eur(g.targetAmount),
        current: eur(current),
        remaining: eur(p.remaining),
        progress_pct: pct(p.pct),
        deadline: g.deadline,
        monthly_needed: p.monthlyNeeded === null ? null : eur(p.monthlyNeeded),
        account: account?.name ?? null,
      };
    }),
  };
}

/**
 * Exécute un outil. Ne lève jamais : outil inconnu, entrée invalide ou erreur interne → `{ error }`.
 * `today` (YYYY-MM-DD) sert de référence pour le mois en cours et les objectifs.
 */
export async function runTool(db: Db, name: string, input: unknown, today: string = todayLocal()): Promise<unknown> {
  try {
    switch (name) {
      case "get_overview": {
        const parsed = noInput.safeParse(input ?? {});
        if (!parsed.success) return { error: firstIssue(parsed.error) };
        return getOverviewTool(db, today);
      }
      case "search_transactions": {
        const parsed = searchInput.safeParse(input ?? {});
        if (!parsed.success) return { error: firstIssue(parsed.error) };
        return searchTransactionsTool(db, parsed.data);
      }
      case "spending_by_category": {
        const parsed = period.safeParse(input ?? {});
        if (!parsed.success) return { error: firstIssue(parsed.error) };
        return spendingByCategoryTool(db, parsed.data, today);
      }
      case "get_holdings": {
        const parsed = noInput.safeParse(input ?? {});
        if (!parsed.success) return { error: firstIssue(parsed.error) };
        return getHoldingsTool(db);
      }
      case "get_goals": {
        const parsed = noInput.safeParse(input ?? {});
        if (!parsed.success) return { error: firstIssue(parsed.error) };
        return getGoalsTool(db, today);
      }
      default:
        return { error: `Outil inconnu : ${name}` };
    }
  } catch (err) {
    console.error(`[ai] échec de l'outil ${name} :`, err);
    return { error: "Erreur interne lors de la lecture des données." };
  }
}
