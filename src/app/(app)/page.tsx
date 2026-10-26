import type { Metadata } from "next";
import { getDb } from "@/lib/db";
import { todayLocal } from "@/lib/dates";
import { currentPeriod, forecastFor } from "@/lib/forecast";
import { formatDateLong, formatMonth } from "@/lib/format";
import { latestProactive } from "@/lib/queries/messages";
import { getOverview } from "@/lib/queries/overview";
import { listRecurring } from "@/lib/queries/recurring";
import { listSnapshots, recordSnapshot } from "@/lib/queries/snapshots";
import { BudgetStrip } from "@/components/dashboard/budget-strip";
import { HomeHero } from "@/components/dashboard/home-hero";
import { LatestMessageCard } from "@/components/dashboard/latest-message-card";
import { MonthStats } from "@/components/dashboard/month-stats";
import { RecentTransactions } from "@/components/dashboard/recent-transactions";
import { HeaderTitle } from "@/components/shell/header-title";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Accueil" };

export default function HomePage() {
  const db = getDb();
  const today = todayLocal();

  recordSnapshot(db, today);
  const overview = getOverview(db, today);
  const points = listSnapshots(db, 90).map((s) => ({
    date: s.date,
    netWorth: s.netWorth,
  }));
  const latestMessage = latestProactive(db);
  const fresh = overview.recent.length === 0;
  // Ligne « Fin de mois prévue » : seulement si des dépenses récurrentes sont déclarées.
  const forecast = listRecurring(db).length > 0 ? forecastFor(db, currentPeriod(today)) : null;

  return (
    // Conteneur de requêtes : la grille suit la largeur réelle du contenu (colonne Claude ouverte ou non).
    <div className="@container">
      <header className="mb-5 space-y-1 md:mb-7">
        <p className="text-[13px] font-medium text-muted first-letter:uppercase">{formatDateLong(today)}</p>
        {/* Sur téléphone, l'en-tête de l'application salue déjà : titre réservé aux lecteurs d'écran. */}
        <HeaderTitle
          as="h1"
          className="sr-only text-2xl font-bold tracking-[-0.025em] text-fg md:not-sr-only md:text-[28px]"
        />
      </header>

      <div className="grid grid-cols-1 gap-5 sm:gap-6 @2xl:grid-cols-12">
        <HomeHero
          netWorth={overview.netWorth}
          cash={overview.cash}
          investments={overview.investments}
          points={points}
          className="@2xl:col-span-7 @2xl:col-start-1 @2xl:row-start-1 @5xl:col-span-8"
        />
        {latestMessage && (
          <LatestMessageCard
            message={latestMessage}
            className="@2xl:col-span-7 @2xl:col-start-1 @2xl:row-start-2 @5xl:col-span-8"
          />
        )}
        <MonthStats
          income={overview.month.income}
          expenses={overview.month.expenses}
          savingsRate={overview.savingsRate}
          monthLabel={formatMonth(today)}
          forecast={forecast && { forecast: forecast.forecast, dueTotal: forecast.dueTotal, margin: forecast.margin }}
          className={cn(
            "@2xl:col-span-5 @2xl:col-start-8 @2xl:row-start-1 @5xl:col-span-4 @5xl:col-start-9",
            // À côté du héros et du dernier message de Claude quand il y en a un.
            latestMessage && "@2xl:row-span-2",
          )}
        />
        <BudgetStrip budgets={overview.budgets} className="min-w-0 @2xl:col-span-12" />
        {!fresh && <RecentTransactions transactions={overview.recent} className="@2xl:col-span-12" />}
      </div>
    </div>
  );
}
