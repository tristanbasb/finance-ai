import { describe, expect, it } from "vitest";
import { buildHoldingGroups, type HoldingRow } from "@/components/investments/types";

function row(id: number, accountId: number, value: number, cost: number): HoldingRow {
  return {
    id,
    accountId,
    symbol: `S${id}`,
    name: `Ligne ${id}`,
    assetType: "etf",
    quantity: 1,
    avgPrice: cost,
    manualPrice: null,
    currency: "EUR",
    price: value,
    source: "cache",
    value,
    cost,
    pnl: value - cost,
    pnlPct: cost === 0 ? 0 : (value - cost) / cost,
  };
}

describe("buildHoldingGroups", () => {
  it("sépare les comptes archivés (hors totaux) et ignore les comptes sans position", () => {
    const accountsList = [
      { id: 1, name: "PEA", color: "#111111", archived: false },
      { id: 2, name: "Ancien CTO", color: "#222222", archived: true },
      { id: 3, name: "Vide", color: "#333333", archived: false },
    ];
    const { active, archived } = buildHoldingGroups(accountsList, [row(1, 1, 1_000, 800), row(2, 2, 500, 400), row(3, 1, 200, 200)]);
    expect(active.map((g) => g.account.name)).toEqual(["PEA"]);
    expect(active[0]).toMatchObject({ value: 1_200, cost: 1_000, pnl: 200 });
    expect(archived.map((g) => g.account.name)).toEqual(["Ancien CTO"]);
    expect(archived[0].holdings.map((h) => h.id)).toEqual([2]);
  });
});
