import type { Metadata } from "next";
import Link from "next/link";
import { ChartPie, CircleAlert, Settings2, Target } from "lucide-react";
import { getDb } from "@/lib/db";
import { todayLocal } from "@/lib/dates";
import { budgetStatus, monthRange } from "@/lib/finance";
import { parseMonthParam, type BudgetRowData } from "@/lib/budget-month";
import { formatMonth, formatPercent } from "@/lib/format";
import { formatEUR } from "@/lib/money";
import { listCategories } from "@/lib/queries/categories";
import { spendingByCategory } from "@/lib/queries/transactions";
import { AiInsightsCard } from "@/components/ai-insights-card";
import { BudgetList } from "@/components/budgets/budget-list";
import { BudgetMonthNav } from "@/components/budgets/budget-month-nav";
import { CategoryDonut } from "@/components/charts/category-donut";
import { QuickAddButton } from "@/components/quick-add/quick-add-button";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { HeroHalos } from "@/components/ui/hero-halos";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Budgets" };

export default async function BudgetsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string | string[] }>;
}) {
  const params = await searchParams;
  const currentMonth = todayLocal().slice(0, 7);
  const month = parseMonthParam(params.month, currentMonth);
  const monthLabel = formatMonth(month);

  const db = getDb();
  const { start, end } = monthRange(month);
  const spending = spendingByCategory(db, start, end);
  const spentById = new Map(spending.filter((s) => s.categoryId !== null).map((s) => [s.categoryId as number, s.total]));
  const uncategorized = spending.find((s) => s.categoryId === null)?.total ?? 0;

  const rows: BudgetRowData[] = listCategories(db)
    .filter((c) => c.kind === "expense")
    .map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      icon: c.icon,
      budget: c.monthlyBudget,
      spent: spentById.get(c.id) ?? 0,
    }));

  const slices = spending.map((s) => ({
    key: String(s.categoryId ?? "none"),
    name: s.name,
    color: s.color,
    value: s.total,
  }));

  const budgeted = rows.filter((r) => r.budget !== null);
  const totalBudget = budgeted.reduce((sum, r) => sum + (r.budget ?? 0), 0);
  const totalSpent = budgeted.reduce((sum, r) => sum + r.spent, 0);
  const overCount = budgeted.filter((r) => budgetStatus(r.spent, r.budget)?.level === "over").length;
  const summary = budgetStatus(totalSpent, totalBudget);
  const left = totalBudget - totalSpent;

  return (
    <div className="space-y-4 sm:space-y-5">
      <header className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <p className="text-[13px] text-muted">Plafonds mensuels par catégorie</p>
          <h1 className="text-2xl font-semibold tracking-[-0.025em] text-fg sm:text-[28px]">Budgets</h1>
        </div>
        <BudgetMonthNav month={month} currentMonth={currentMonth} />
      </header>

      <section
        aria-label="Synthèse des budgets"
        className="relative overflow-hidden rounded-hero bg-brand-gradient p-6 text-white shadow-glow sm:p-8"
      >
        <HeroHalos />
        <div className="relative space-y-4">
          {summary ? (
            <>
              <div className="space-y-1">
                <p className="text-[13px] font-semibold text-white first-letter:uppercase">
                  {monthLabel}, catégories avec budget
                </p>
                <p className="num text-[36px] font-semibold leading-none tracking-[-0.035em] sm:text-[48px]">
                  {formatEUR(totalSpent)}
                  <span className="ml-2 text-[0.4em] font-medium text-white">sur {formatEUR(totalBudget)}</span>
                </p>
              </div>
              <div
                role="progressbar"
                aria-label="Budgets consommés"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(Math.min(summary.pct, 1) * 100)}
                aria-valuetext={`${formatPercent(summary.pct)} des budgets utilisés`}
                className="h-2.5 w-full overflow-hidden rounded-full bg-black/20"
              >
                <div className="h-full rounded-full bg-white" style={{ width: `${Math.min(summary.pct, 1) * 100}%` }} />
              </div>
              <p className="num flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] font-medium text-white">
                <span>{left >= 0 ? `Il vous reste ${formatEUR(left)}` : `Vous dépassez de ${formatEUR(-left)} au total`}</span>
                {overCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-black/25 px-2.5 py-1">
                    <CircleAlert aria-hidden className="size-3.5" />
                    {overCount} {overCount > 1 ? "budgets dépassés" : "budget dépassé"}
                  </span>
                )}
              </p>
            </>
          ) : (
            <div className="space-y-2">
              <p className="inline-flex items-center gap-2 text-[13px] font-semibold text-white">
                <Target aria-hidden className="size-4" />
                Aucun budget défini
              </p>
              <p className="max-w-md text-lg font-semibold tracking-[-0.02em] sm:text-xl">
                Choisissez une catégorie ci-dessous et définissez son plafond mensuel pour suivre vos dépenses.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Deux colonnes selon la largeur réelle du contenu (colonne Claude affichée ou non), pas celle de la fenêtre. */}
      <div className="@container">
        <div className="grid grid-cols-1 gap-4 sm:gap-5 @2xl:grid-cols-2">
          <Card className="@2xl:self-start">
            <CardHeader>
              <CardTitle>Dépenses par catégorie</CardTitle>
              <CardDescription className="first-letter:uppercase">{monthLabel}</CardDescription>
            </CardHeader>
            <CardContent>
              {slices.length === 0 ? (
                <EmptyState
                  icon={ChartPie}
                  title="Aucune dépense ce mois-ci"
                  description="Ajoutez une opération pour voir la répartition de vos dépenses."
                  action={<QuickAddButton variant="secondary" size="sm" />}
                />
              ) : (
                <CategoryDonut slices={slices} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader
              action={
                <Link href="/settings#categories" className={buttonClasses({ variant: "secondary", size: "sm" })}>
                  <Settings2 aria-hidden />
                  Gérer les catégories
                </Link>
              }
            >
              <CardTitle>Catégories</CardTitle>
              <CardDescription>Touchez un budget pour le modifier.</CardDescription>
            </CardHeader>
            <CardContent>
              {rows.length === 0 ? (
                <EmptyState
                  icon={Target}
                  title="Aucune catégorie de dépense"
                  description="Créez des catégories pour fixer un budget et suivre vos dépenses."
                  action={
                    <Link href="/settings#categories" className={buttonClasses({ variant: "secondary", size: "sm" })}>
                      <Settings2 aria-hidden />
                      Gérer les catégories
                    </Link>
                  }
                />
              ) : (
                <>
                  <BudgetList rows={rows} />
                  {uncategorized > 0 && (
                    <p className="num mt-4 flex items-center justify-between gap-3 border-t border-border pt-4 text-[13px] text-muted">
                      <span>Sans catégorie (pas de budget possible)</span>
                      <span className="font-medium text-fg">{formatEUR(uncategorized)}</span>
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <AiInsightsCard month={month} monthLabel={monthLabel} />
    </div>
  );
}
