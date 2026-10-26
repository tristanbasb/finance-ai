import type { Metadata } from "next";
import { getDb } from "@/lib/db";
import { todayLocal } from "@/lib/dates";
import { resolvePrice } from "@/lib/prices";
import { parseSection } from "@/lib/patrimoine";
import { listAccountsWithBalances } from "@/lib/queries/accounts";
import { listGoals } from "@/lib/queries/goals";
import { listHoldingsWithValues } from "@/lib/queries/holdings";
import { getOverview } from "@/lib/queries/overview";
import { lastNewsFetch, listNews, newsCounts } from "@/lib/news/store";
import { NEWS_PAGE } from "@/lib/news-ui";
import { AccountsSection } from "@/components/patrimoine/accounts-section";
import { NewsSection } from "@/components/patrimoine/news-section";
import { PatrimoineHero } from "@/components/patrimoine/patrimoine-hero";
import { SectionNav } from "@/components/patrimoine/section-nav";
import { InvestmentsSection } from "@/components/investments/investments-section";
import { buildHoldingGroups, type HoldingRow } from "@/components/investments/types";
import type { GoalView } from "@/components/savings/goal-dialog";
import { GoalsSection } from "@/components/savings/goals-section";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Patrimoine" };

export default async function PatrimoinePage({ searchParams }: { searchParams: Promise<{ section?: string | string[] }> }) {
  const { section } = await searchParams;
  const initialSection = parseSection(Array.isArray(section) ? section[0] : section);

  const db = getDb();
  const now = new Date();
  const today = todayLocal();
  const overview = getOverview(db, today);
  const accounts = listAccountsWithBalances(db);
  const active = accounts.filter((a) => !a.archived);
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

  // `resolvePrice` distingue un cours « live » (moins de 15 min) d'un cours en cache.
  const rows: HoldingRow[] = listHoldingsWithValues(db).map((h) => ({
    id: h.id,
    accountId: h.accountId,
    symbol: h.symbol,
    name: h.name,
    assetType: h.assetType,
    quantity: h.quantity,
    avgPrice: h.avgPrice,
    manualPrice: h.manualPrice,
    currency: h.currency,
    price: h.price,
    source: resolvePrice(db, h, now).source,
    value: h.value,
    cost: h.cost,
    pnl: h.pnl,
    pnlPct: h.pnlPct,
  }));

  const { active: activeGroups, archived: archivedGroups } = buildHoldingGroups(
    accounts.map((a) => ({ id: a.id, name: a.name, color: a.color, archived: a.archived })),
    rows,
  );

  const held = activeGroups.flatMap((g) => g.holdings);
  const heldValue = held.reduce((sum, h) => sum + h.value, 0);
  const heldCost = held.reduce((sum, h) => sum + h.cost, 0);
  // Actualités : nombre par position cotée sur 7 jours (section masquée sans position cotée).
  const newsCountsByHolding = newsCounts(db, now.getTime() - 7 * 86_400_000);
  const savings = active.filter((a) => a.type === "savings").reduce((sum, a) => sum + a.balance, 0);

  return (
    <div className="space-y-6 sm:space-y-8">
      <header className="space-y-1">
        <p className="text-[13px] text-muted">Comptes, objectifs et placements</p>
        <h1 className="text-2xl font-semibold tracking-[-0.025em] text-fg max-md:sr-only md:text-[28px]">Patrimoine</h1>
      </header>

      <PatrimoineHero
        netWorth={overview.netWorth}
        liquidities={overview.cash - savings}
        savings={savings}
        investments={overview.investments}
        pnl={held.length > 0 ? { amount: heldValue - heldCost, pct: heldCost === 0 ? 0 : (heldValue - heldCost) / heldCost } : null}
      />

      <SectionNav initialSection={initialSection} showNews={newsCountsByHolding.length > 0} />

      <AccountsSection
        accounts={active.map((a) => ({ id: a.id, name: a.name, type: a.type, color: a.color, total: a.total }))}
      />

      <GoalsSection
        goalAccounts={accounts
          .filter((a) => a.type === "savings" || a.type === "checking" || a.type === "other")
          .map((a) => ({ id: a.id, name: a.name, archived: a.archived, balance: a.balance }))}
        goals={goals}
        today={today}
      />

      <InvestmentsSection
        groups={activeGroups}
        archivedGroups={archivedGroups}
        accounts={accounts
          .filter((a) => a.type === "investment" || a.type === "crypto" || a.type === "other")
          .map((a) => ({ id: a.id, name: a.name, archived: a.archived }))}
      />

      {newsCountsByHolding.length > 0 && (
        <NewsSection
          initial={listNews(db, { limit: NEWS_PAGE })}
          counts={newsCountsByHolding}
          lastFetch={lastNewsFetch(db)}
        />
      )}
    </div>
  );
}
