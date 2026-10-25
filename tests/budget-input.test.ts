import { describe, expect, it } from "vitest";
import { parseBudgetInput } from "@/lib/budget-input";
import { parseMonthParam, shiftMonth, sortBudgetRows, type BudgetRowData } from "@/lib/budget-month";

describe("parseBudgetInput", () => {
  it("vide ou espaces : supprime le budget", () => {
    expect(parseBudgetInput("")).toEqual({ ok: true, cents: null });
    expect(parseBudgetInput("   ")).toEqual({ ok: true, cents: null });
  });
  it("lit les montants à la française", () => {
    expect(parseBudgetInput("450")).toEqual({ ok: true, cents: 45000 });
    expect(parseBudgetInput("1 234,5")).toEqual({ ok: true, cents: 123450 });
    expect(parseBudgetInput("99,99 €")).toEqual({ ok: true, cents: 9999 });
  });
  it("refuse négatif, zéro, illisible et démesuré", () => {
    for (const raw of ["-5", "abc", "0", "0,00", "99999999999"]) {
      const r = parseBudgetInput(raw);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).not.toBe("");
    }
  });
});

describe("mois", () => {
  it("valide le paramètre", () => {
    expect(parseMonthParam("2026-03", "2026-10")).toBe("2026-03");
    expect(parseMonthParam("2026-13", "2026-10")).toBe("2026-10");
    expect(parseMonthParam(undefined, "2026-10")).toBe("2026-10");
    expect(parseMonthParam(["2026-02", "x"], "2026-10")).toBe("2026-02");
  });
  it("décale d'un mois", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
});

describe("sortBudgetRows", () => {
  const row = (id: number, budget: number | null, spent: number): BudgetRowData => ({
    id, name: `c${id}`, color: "#000000", icon: "tag", budget, spent,
  });
  it("dépassés, puis % décroissant, puis sans budget par dépense", () => {
    const sorted = sortBudgetRows([
      row(1, null, 500), row(2, 1000, 500), row(3, 1000, 1500), row(4, 1000, 900), row(5, null, 900),
    ]);
    expect(sorted.map((r) => r.id)).toEqual([3, 4, 2, 5, 1]);
  });
});
