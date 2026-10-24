import { describe, expect, it } from "vitest";
import {
  accountBalance,
  budgetStatus,
  goalProgress,
  holdingPnl,
  holdingValue,
  monthRange,
  savingsRate,
} from "@/lib/finance";

describe("accountBalance", () => {
  it("additionne le solde initial et les transactions signées", () => {
    expect(accountBalance(100000, [-1250, 5000, -300])).toBe(103450);
    expect(accountBalance(500, [])).toBe(500);
  });
});

describe("holdingValue", () => {
  it("multiplie quantité et prix (centimes) en arrondissant", () => {
    expect(holdingValue({ quantity: 2, price: 12500 })).toBe(25000);
    expect(holdingValue({ quantity: 0.333, price: 1000 })).toBe(333);
    expect(holdingValue({ quantity: 1.5, price: 101 })).toBe(152);
  });
});

describe("holdingPnl", () => {
  it("calcule valeur, coût, plus-value et pourcentage", () => {
    expect(holdingPnl({ quantity: 2, avgPrice: 10000, price: 12500 })).toEqual({
      value: 25000,
      cost: 20000,
      pnl: 5000,
      pnlPct: 0.25,
    });
  });
  it("gère une moins-value", () => {
    const r = holdingPnl({ quantity: 10, avgPrice: 1000, price: 800 });
    expect(r).toEqual({ value: 8000, cost: 10000, pnl: -2000, pnlPct: -0.2 });
  });
  it("retourne pnlPct = 0 si le coût est nul", () => {
    expect(holdingPnl({ quantity: 5, avgPrice: 0, price: 1000 })).toEqual({
      value: 5000,
      cost: 0,
      pnl: 5000,
      pnlPct: 0,
    });
  });
});

describe("savingsRate", () => {
  it("calcule (revenus + dépenses) / revenus", () => {
    expect(savingsRate(300000, -210000)).toBe(0.3);
  });
  it("retourne 0 si les revenus sont nuls ou négatifs", () => {
    expect(savingsRate(0, -1000)).toBe(0);
    expect(savingsRate(-5, -1000)).toBe(0);
  });
  it("peut être négatif quand on dépense plus qu'on ne gagne", () => {
    expect(savingsRate(100000, -150000)).toBe(-0.5);
  });
});

describe("goalProgress", () => {
  const today = "2026-10-24";
  it("calcule le montant mensuel nécessaire (6 mois restants)", () => {
    const r = goalProgress({ target: 100000, current: 40000, deadline: "2027-04-24" }, today);
    expect(r.pct).toBe(0.4);
    expect(r.remaining).toBe(60000);
    expect(r.monthlyNeeded).toBe(10000);
  });
  it("arrondit le montant mensuel au centime supérieur", () => {
    const r = goalProgress({ target: 100000, current: 0, deadline: "2027-04-24" }, today);
    expect(r.monthlyNeeded).toBe(16667);
  });
  it("compte les mois calendaires entiers (jour d'échéance antérieur = un mois de moins)", () => {
    const r = goalProgress({ target: 100000, current: 40000, deadline: "2027-04-10" }, today);
    expect(r.monthlyNeeded).toBe(12000); // 5 mois
  });
  it("vaut au moins 1 mois (échéance dépassée ou même mois)", () => {
    expect(
      goalProgress({ target: 100000, current: 40000, deadline: "2026-10-30" }, today).monthlyNeeded,
    ).toBe(60000);
    expect(
      goalProgress({ target: 100000, current: 40000, deadline: "2026-01-01" }, today).monthlyNeeded,
    ).toBe(60000);
  });
  it("retourne null sans échéance", () => {
    expect(goalProgress({ target: 100000, current: 40000, deadline: null }, today).monthlyNeeded).toBeNull();
  });
  it("retourne 0 quand l'objectif est atteint ou dépassé, avec pct borné à 1", () => {
    const r = goalProgress({ target: 100000, current: 120000, deadline: "2027-04-24" }, today);
    expect(r).toEqual({ pct: 1, remaining: 0, monthlyNeeded: 0 });
  });
  it("borne pct à 0 pour un montant courant négatif et gère une cible nulle", () => {
    expect(goalProgress({ target: 100000, current: -500, deadline: null }, today).pct).toBe(0);
    expect(goalProgress({ target: 0, current: 0, deadline: null }, today).pct).toBe(1);
  });
});

describe("budgetStatus", () => {
  it("retourne null sans budget", () => {
    expect(budgetStatus(5000, null)).toBeNull();
  });
  it("classe ok / warn / over", () => {
    expect(budgetStatus(5000, 10000)).toEqual({ pct: 0.5, level: "ok" });
    expect(budgetStatus(8500, 10000)?.level).toBe("warn");
    expect(budgetStatus(8000, 10000)?.level).toBe("warn");
    expect(budgetStatus(10000, 10000)?.level).toBe("warn");
    expect(budgetStatus(10001, 10000)?.level).toBe("over");
  });
  it("gère un budget nul", () => {
    expect(budgetStatus(0, 0)).toEqual({ pct: 0, level: "ok" });
    expect(budgetStatus(100, 0)?.level).toBe("over");
  });
});

describe("monthRange", () => {
  it("donne le premier et le dernier jour du mois", () => {
    expect(monthRange("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(monthRange("2028-02").end).toBe("2028-02-29");
    expect(monthRange("2026-12")).toEqual({ start: "2026-12-01", end: "2026-12-31" });
    expect(monthRange("2026-04").end).toBe("2026-04-30");
  });
});
