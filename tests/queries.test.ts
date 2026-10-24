import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { seedDefaults } from "@/lib/db/seed";
import { accounts, categories, goals, holdings, prices, transactions } from "@/lib/db/schema";
import { ConflictError, NotFoundError } from "@/lib/api";
import { deleteAccount, listAccountsWithBalances, updateAccount } from "@/lib/queries/accounts";
import { deleteCategory } from "@/lib/queries/categories";
import {
  createTransaction,
  createTransactions,
  listTransactions,
  monthTotals,
  spendingByCategory,
  updateTransaction,
} from "@/lib/queries/transactions";
import { listHoldingsWithValues, unitPrice } from "@/lib/queries/holdings";
import { getOverview } from "@/lib/queries/overview";
import { exportAll } from "@/lib/queries/export";
import {
  holdingInput,
  importInput,
  transactionFilters,
  transactionInput,
} from "@/lib/validation";

function freshDb() {
  const db = createDb(":memory:");
  runMigrations(db);
  seedDefaults(db);
  return db;
}

type TestDb = ReturnType<typeof freshDb>;

function catId(db: TestDb, name: string): number {
  return db.select().from(categories).where(eq(categories.name, name)).get()!.id;
}

function addAccount(db: TestDb, name: string, initialBalance = 0, archived = false) {
  return db
    .insert(accounts)
    .values({ name, type: "savings", initialBalance, archived })
    .returning()
    .get().id;
}

describe("listAccountsWithBalances", () => {
  it("solde = solde initial + transactions", () => {
    const db = freshDb();
    const acc = db.select().from(accounts).get()!;
    db.update(accounts).set({ initialBalance: 100_000 }).where(eq(accounts.id, acc.id)).run();
    createTransactions(db, [
      { accountId: acc.id, date: "2026-10-01", amount: 250_000, label: "Salaire" },
      { accountId: acc.id, date: "2026-10-02", amount: -4_550, label: "Courses" },
    ]);
    const [row] = listAccountsWithBalances(db);
    expect(row.balance).toBe(100_000 + 250_000 - 4_550);
    expect(row.investmentsValue).toBe(0);
    expect(row.total).toBe(row.balance);
  });

  it("ajoute la valeur des positions (cache, prix manuel, sinon coût) et inclut les comptes archivés", () => {
    const db = freshDb();
    const inv = addAccount(db, "PEA", 50_000);
    const old = addAccount(db, "Ancien", 1_000, true);
    db.insert(prices).values({ symbol: "CW8", price: 10_000, currency: "EUR", fetchedAt: 1 }).run();
    db.insert(holdings)
      .values([
        { accountId: inv, symbol: "CW8", name: "ETF", assetType: "etf", quantity: 2, avgPrice: 9_000 },
        { accountId: inv, symbol: "BIEN", name: "Bien", assetType: "manual", quantity: 1, avgPrice: 100, manualPrice: 5_000 },
        { accountId: inv, symbol: "XYZ", name: "Sans cours", assetType: "stock", quantity: 3, avgPrice: 200 },
      ])
      .run();
    const rows = listAccountsWithBalances(db);
    const pea = rows.find((r) => r.id === inv)!;
    expect(pea.investmentsValue).toBe(2 * 10_000 + 5_000 + 3 * 200);
    expect(pea.total).toBe(50_000 + pea.investmentsValue);
    expect(rows.find((r) => r.id === old)).toMatchObject({ archived: true, balance: 1_000 });
  });
});

describe("unitPrice / listHoldingsWithValues", () => {
  it("priorité : manuel, puis cache, puis coût moyen", () => {
    expect(unitPrice({ assetType: "manual", manualPrice: 500, avgPrice: 100 }, 900)).toEqual({ price: 500, source: "manual" });
    expect(unitPrice({ assetType: "stock", manualPrice: 500, avgPrice: 100 }, 900)).toEqual({ price: 900, source: "cache" });
    expect(unitPrice({ assetType: "manual", manualPrice: null, avgPrice: 100 }, 900)).toEqual({ price: 900, source: "cache" });
    expect(unitPrice({ assetType: "stock", manualPrice: null, avgPrice: 100 }, null)).toEqual({ price: 100, source: "cost" });
  });

  it("calcule valeur, coût et plus-value", () => {
    const db = freshDb();
    const acc = db.select().from(accounts).get()!.id;
    db.insert(prices).values({ symbol: "AAPL", price: 20_000, currency: "EUR", fetchedAt: 1 }).run();
    db.insert(holdings)
      .values({ accountId: acc, symbol: "AAPL", name: "Apple", assetType: "stock", quantity: 2, avgPrice: 15_000 })
      .run();
    const [h] = listHoldingsWithValues(db);
    expect(h).toMatchObject({ price: 20_000, priceSource: "cache", value: 40_000, cost: 30_000, pnl: 10_000 });
    expect(h.pnlPct).toBeCloseTo(1 / 3);
  });
});

describe("transactions", () => {
  it("createTransactions insère 3 lignes dans une transaction SQL", () => {
    const db = freshDb();
    const acc = db.select().from(accounts).get()!.id;
    const n = createTransactions(db, [
      { accountId: acc, date: "2026-10-01", amount: -100, label: "A" },
      { accountId: acc, date: "2026-10-02", amount: -200, label: "B" },
      { accountId: acc, date: "2026-10-03", amount: 300, label: "C" },
    ]);
    expect(n).toBe(3);
    expect(db.select().from(transactions).all()).toHaveLength(3);
  });

  it("annule tout si une ligne échoue (compte inexistant)", () => {
    const db = freshDb();
    const acc = db.select().from(accounts).get()!.id;
    expect(() =>
      createTransactions(db, [
        { accountId: acc, date: "2026-10-01", amount: -100, label: "A" },
        { accountId: 9999, date: "2026-10-02", amount: -200, label: "B" },
      ]),
    ).toThrow();
    expect(db.select().from(transactions).all()).toHaveLength(0);
  });

  it("listTransactions filtre par mois, libellé (insensible à la casse), compte, catégorie et limite", () => {
    const db = freshDb();
    const acc = db.select().from(accounts).get()!.id;
    const other = addAccount(db, "Autre");
    const food = catId(db, "Alimentation");
    createTransactions(db, [
      { accountId: acc, categoryId: food, date: "2026-10-05", amount: -1_000, label: "Carrefour Market" },
      { accountId: acc, date: "2026-10-20", amount: -2_000, label: "Loyer" },
      { accountId: acc, date: "2026-09-30", amount: -3_000, label: "CARREFOUR city" },
      { accountId: other, date: "2026-10-07", amount: -4_000, label: "100% promo_x" },
    ]);
    expect(listTransactions(db, { month: "2026-10" })).toHaveLength(3);
    expect(listTransactions(db, { q: "carrefour" }).map((t) => t.label).sort()).toEqual([
      "CARREFOUR city",
      "Carrefour Market",
    ]);
    expect(listTransactions(db, { accountId: other })).toHaveLength(1);
    expect(listTransactions(db, { categoryId: food })).toHaveLength(1);
    expect(listTransactions(db, { q: "%" })).toHaveLength(1); // les jokers LIKE sont échappés
    expect(listTransactions(db, { q: "_" })).toHaveLength(1);
    expect(listTransactions(db, { limit: 2 })).toHaveLength(2);
    const all = listTransactions(db, {});
    expect(all.map((t) => t.date)).toEqual(["2026-10-20", "2026-10-07", "2026-10-05", "2026-09-30"]);
    expect(all[2]).toMatchObject({ categoryName: "Alimentation", accountName: "Compte courant" });
    expect(all[0].categoryName).toBeNull();
  });

  it("updateTransaction / NotFoundError", () => {
    const db = freshDb();
    const acc = db.select().from(accounts).get()!.id;
    const t = createTransaction(db, { accountId: acc, date: "2026-10-01", amount: -100, label: "A" });
    expect(updateTransaction(db, t.id, { amount: -150 })).toMatchObject({ id: t.id, amount: -150, label: "A" });
    expect(() => updateTransaction(db, 9999, { amount: 1 })).toThrow(NotFoundError);
  });
});

describe("spendingByCategory / monthTotals", () => {
  it("n'inclut que les montants < 0 de la période, regroupés et triés", () => {
    const db = freshDb();
    const acc = db.select().from(accounts).get()!.id;
    const food = catId(db, "Alimentation");
    const transport = catId(db, "Transport");
    const salary = catId(db, "Salaire");
    createTransactions(db, [
      { accountId: acc, categoryId: food, date: "2026-10-01", amount: -3_000, label: "a" },
      { accountId: acc, categoryId: food, date: "2026-10-31", amount: -2_000, label: "b" },
      { accountId: acc, categoryId: transport, date: "2026-10-10", amount: -7_000, label: "c" },
      { accountId: acc, categoryId: salary, date: "2026-10-05", amount: 200_000, label: "paie" },
      { accountId: acc, date: "2026-10-06", amount: -500, label: "sans catégorie" },
      { accountId: acc, categoryId: food, date: "2026-09-30", amount: -9_999, label: "hors période" },
      { accountId: acc, categoryId: food, date: "2026-11-01", amount: -9_999, label: "hors période" },
    ]);
    const res = spendingByCategory(db, "2026-10-01", "2026-10-31");
    expect(res.map((r) => [r.name, r.total])).toEqual([
      ["Transport", 7_000],
      ["Alimentation", 5_000],
      ["Sans catégorie", 500],
    ]);
    expect(res[2]).toMatchObject({ categoryId: null, color: "#94a3b8" });
    expect(monthTotals(db, "2026-10")).toEqual({ income: 200_000, expenses: -12_500 });
    expect(monthTotals(db, "2025-01")).toEqual({ income: 0, expenses: 0 });
  });
});

describe("getOverview", () => {
  it("patrimoine = trésorerie + investissements ; comptes archivés exclus", () => {
    const db = freshDb();
    const acc = db.select().from(accounts).get()!.id;
    const pea = addAccount(db, "PEA", 10_000);
    const archived = addAccount(db, "Fermé", 99_999, true);
    db.insert(holdings)
      .values([
        { accountId: pea, symbol: "X", name: "X", assetType: "etf", quantity: 2, avgPrice: 1_500 },
        { accountId: archived, symbol: "Y", name: "Y", assetType: "etf", quantity: 1, avgPrice: 77_777 },
      ])
      .run();
    const food = catId(db, "Alimentation");
    const salary = catId(db, "Salaire");
    db.update(categories).set({ monthlyBudget: 40_000 }).where(eq(categories.id, food)).run();
    createTransactions(db, [
      { accountId: acc, categoryId: salary, date: "2026-10-01", amount: 300_000, label: "Paie" },
      { accountId: acc, categoryId: food, date: "2026-10-02", amount: -35_000, label: "Courses" },
      { accountId: acc, categoryId: food, date: "2026-09-02", amount: -1_000, label: "Ancien" },
    ]);
    const o = getOverview(db, "2026-10-15");
    expect(o.cash).toBe(10_000 + 300_000 - 35_000 - 1_000);
    expect(o.investments).toBe(3_000);
    expect(o.netWorth).toBe(o.cash + o.investments);
    expect(o.month).toEqual({ income: 300_000, expenses: -35_000 });
    expect(o.savingsRate).toBeCloseTo((300_000 - 35_000) / 300_000);
    expect(o.budgets).toHaveLength(1);
    expect(o.budgets[0]).toMatchObject({ categoryId: food, name: "Alimentation", budget: 40_000, spent: 35_000 });
    expect(o.budgets[0].status).toMatchObject({ level: "warn" });
    expect(o.recent).toHaveLength(3);
    expect(o.recent[0]).toMatchObject({ label: "Courses", categoryName: "Alimentation", accountName: "Compte courant" });
  });

  it("limite les dernières transactions à 5", () => {
    const db = freshDb();
    const acc = db.select().from(accounts).get()!.id;
    createTransactions(
      db,
      Array.from({ length: 8 }, (_, i) => ({
        accountId: acc,
        date: `2026-10-0${i + 1}`,
        amount: -100,
        label: `t${i}`,
      })),
    );
    const o = getOverview(db, "2026-10-15");
    expect(o.recent.map((t) => t.label)).toEqual(["t7", "t6", "t5", "t4", "t3"]);
  });
});

describe("suppressions", () => {
  it("deleteAccount avec transactions → ConflictError", () => {
    const db = freshDb();
    const acc = db.select().from(accounts).get()!.id;
    createTransaction(db, { accountId: acc, date: "2026-10-01", amount: -100, label: "A" });
    expect(() => deleteAccount(db, acc)).toThrow(ConflictError);
    expect(() => deleteAccount(db, acc)).toThrow("Ce compte contient des données, archivez-le plutôt.");
    expect(db.select().from(accounts).all()).toHaveLength(1);
  });

  it("deleteAccount avec positions → ConflictError", () => {
    const db = freshDb();
    const acc = addAccount(db, "PEA");
    db.insert(holdings)
      .values({ accountId: acc, symbol: "X", name: "X", assetType: "etf", quantity: 1, avgPrice: 1 })
      .run();
    expect(() => deleteAccount(db, acc)).toThrow(ConflictError);
  });

  it("deleteAccount vide : supprime et détache les objectifs ; inconnu → NotFoundError", () => {
    const db = freshDb();
    const acc = addAccount(db, "Vide");
    const g = db.insert(goals).values({ name: "Vacances", targetAmount: 100_000, accountId: acc }).returning().get();
    deleteAccount(db, acc);
    expect(db.select().from(accounts).where(eq(accounts.id, acc)).all()).toHaveLength(0);
    expect(db.select().from(goals).where(eq(goals.id, g.id)).get()!.accountId).toBeNull();
    expect(() => deleteAccount(db, acc)).toThrow(NotFoundError);
  });

  it("supprimer une catégorie conserve ses transactions avec categoryId = null", () => {
    const db = freshDb();
    const acc = db.select().from(accounts).get()!.id;
    const food = catId(db, "Alimentation");
    const t = createTransaction(db, { accountId: acc, categoryId: food, date: "2026-10-01", amount: -100, label: "A" });
    deleteCategory(db, food);
    expect(db.select().from(transactions).where(eq(transactions.id, t.id)).get()!.categoryId).toBeNull();
    expect(() => deleteCategory(db, food)).toThrow(NotFoundError);
  });

  it("updateAccount peut archiver", () => {
    const db = freshDb();
    const acc = db.select().from(accounts).get()!.id;
    expect(updateAccount(db, acc, { archived: true }).archived).toBe(true);
  });
});

describe("exportAll", () => {
  it("renvoie toutes les tables", () => {
    const db = freshDb();
    const data = exportAll(db);
    expect(Object.keys(data).sort()).toEqual([
      "accounts",
      "aiCache",
      "categories",
      "goals",
      "holdings",
      "prices",
      "snapshots",
      "transactions",
    ]);
    expect(data.categories).toHaveLength(12);
    expect(data.accounts).toHaveLength(1);
  });
});

describe("schémas zod", () => {
  const base = { accountId: 1, date: "2026-10-01", amount: -1250, label: "Café" };

  it("rejette un montant non entier", () => {
    expect(transactionInput.safeParse({ ...base, amount: 12.5 }).success).toBe(false);
    expect(transactionInput.safeParse(base).success).toBe(true);
  });

  it("valide les dates réelles et les libellés", () => {
    expect(transactionInput.safeParse({ ...base, date: "2026-02-30" }).success).toBe(false);
    expect(transactionInput.safeParse({ ...base, date: "01/10/2026" }).success).toBe(false);
    expect(transactionInput.safeParse({ ...base, label: "   " }).success).toBe(false);
    expect(transactionInput.parse({ ...base, label: "  Café  " }).label).toBe("Café");
  });

  it("partial() pour le PATCH n'injecte aucune valeur par défaut", () => {
    expect(transactionInput.partial().parse({ amount: 5 })).toEqual({ amount: 5 });
  });

  it("holdingInput : symbole en majuscules, quantité > 0, prix réels autorisés", () => {
    const h = { accountId: 1, symbol: " cw8 ", name: "ETF", assetType: "etf", quantity: 0.5, avgPrice: 0.001 };
    expect(holdingInput.parse(h).symbol).toBe("CW8");
    expect(holdingInput.safeParse({ ...h, quantity: 0 }).success).toBe(false);
    expect(holdingInput.safeParse({ ...h, avgPrice: -1 }).success).toBe(false);
  });

  it("importInput : 1 à 5000 lignes", () => {
    const row = { date: "2026-10-01", label: "A", amount: -100 };
    expect(importInput.safeParse({ accountId: 1, rows: [] }).success).toBe(false);
    expect(importInput.safeParse({ accountId: 1, rows: [row] }).success).toBe(true);
    expect(importInput.safeParse({ accountId: 1, rows: Array(5001).fill(row) }).success).toBe(false);
  });

  it("transactionFilters : coercition des paramètres d'URL, limite max 2000", () => {
    expect(transactionFilters.parse({ accountId: "3", limit: "50", month: "2026-10" })).toEqual({
      accountId: 3,
      limit: 50,
      month: "2026-10",
    });
    expect(transactionFilters.safeParse({ limit: "2001" }).success).toBe(false);
    expect(transactionFilters.safeParse({ month: "2026-13" }).success).toBe(false);
  });
});
