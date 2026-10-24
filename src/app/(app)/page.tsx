import type { Metadata } from "next";
import { ArrowDownLeft, ArrowUpRight, PiggyBank } from "lucide-react";
import { getDb } from "@/lib/db";
import { todayLocal } from "@/lib/dates";
import { monthRange } from "@/lib/finance";
import { formatEUR } from "@/lib/money";
import { formatDateLong, formatMonth, formatPercent } from "@/lib/format";
import { getOverview } from "@/lib/queries/overview";
import { listSnapshots, recordSnapshot } from "@/lib/queries/snapshots";
import { spendingByCategory } from "@/lib/queries/transactions";
import { Amount } from "@/components/amount";
import { AiInsightsCard } from "@/components/ai-insights-card";
import { BudgetsCard } from "@/components/dashboard/budgets-card";
import { KpiTile } from "@/components/dashboard/kpi-tile";
import { NetWorthCard } from "@/components/dashboard/net-worth-card";
import { RecentTransactions } from "@/components/dashboard/recent-transactions";
import { SpendingCard } from "@/components/dashboard/spending-card";
import { WelcomeCard } from "@/components/dashboard/welcome-card";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Tableau de bord" };

export default function DashboardPage() {
  const db = getDb();
  const today = todayLocal();
  const month = today.slice(0, 7);
  const monthLabel = formatMonth(month);

  recordSnapshot(db, today);
  const overview = getOverview(db, today);
  const { start, end } = monthRange(month);
  const slices = spendingByCategory(db, start, end).map((s) => ({
    key: String(s.categoryId ?? "none"),
    name: s.name,
    color: s.color,
    value: s.total,
  }));
  const points = listSnapshots(db, 90).map((s) => ({ date: s.date, netWorth: s.netWorth }));

  const { income, expenses } = overview.month;
  const saved = income + expenses;

  return (
    <div className="space-y-4 sm:space-y-5">
      <header className="mb-6 space-y-1 sm:mb-8">
        <p className="text-[13px] text-muted first-letter:uppercase">{formatDateLong(today)}</p>
        <h1 className="text-2xl font-semibold tracking-[-0.025em] text-fg sm:text-[28px]">
          Tableau de bord
        </h1>
      </header>

      {overview.recent.length === 0 && <WelcomeCard />}

      <section aria-label="Vue d'ensemble" className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-3">
        <NetWorthCard
          className="lg:col-span-2"
          netWorth={overview.netWorth}
          cash={overview.cash}
          investments={overview.investments}
          points={points}
        />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 lg:grid-cols-1">
          <KpiTile
            label="Revenus du mois"
            icon={ArrowDownLeft}
            value={<Amount cents={income} tone={income > 0 ? "signed" : "plain"} />}
            caption="Entrées depuis le 1er"
          />
          <KpiTile
            label="Dépenses du mois"
            icon={ArrowUpRight}
            value={<Amount cents={Math.abs(expenses)} />}
            caption="Sorties depuis le 1er"
          />
          <KpiTile
            className="col-span-2 sm:col-span-1"
            label="Taux d'épargne"
            icon={PiggyBank}
            value={income > 0 ? formatPercent(overview.savingsRate) : "—"}
            caption={
              income <= 0
                ? "Aucun revenu ce mois-ci"
                : saved >= 0
                  ? `${formatEUR(saved)} mis de côté`
                  : `${formatEUR(-saved)} de plus que vos revenus`
            }
          />
        </div>
      </section>

      <section aria-label="Dépenses et budgets" className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
        <SpendingCard slices={slices} monthLabel={monthLabel} />
        <BudgetsCard budgets={overview.budgets} monthLabel={monthLabel} />
      </section>

      <section aria-label="Activité" className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RecentTransactions transactions={overview.recent} />
        </div>
        <AiInsightsCard month={month} monthLabel={monthLabel} />
      </section>
    </div>
  );
}
