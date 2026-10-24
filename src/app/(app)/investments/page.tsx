import type { Metadata } from "next";
import { getDb } from "@/lib/db";
import { resolvePrice } from "@/lib/prices";
import { listAccountsWithBalances } from "@/lib/queries/accounts";
import { listHoldingsWithValues } from "@/lib/queries/holdings";
import { buildHoldingGroups, type HoldingRow } from "@/components/investments/types";
import { InvestmentsView } from "@/components/investments/investments-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Investissements" };

export default function InvestmentsPage() {
  const db = getDb();
  const now = new Date();
  const accounts = listAccountsWithBalances(db);

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

  const { active, archived } = buildHoldingGroups(
    accounts.map((a) => ({ id: a.id, name: a.name, color: a.color, archived: a.archived })),
    rows,
  );

  return (
    <InvestmentsView
      groups={active}
      archivedGroups={archived}
      accounts={accounts
        .filter((a) => a.type === "investment" || a.type === "crypto" || a.type === "other")
        .map((a) => ({ id: a.id, name: a.name, archived: a.archived }))}
    />
  );
}
