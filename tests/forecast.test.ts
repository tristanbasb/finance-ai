import { beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { seedDefaults } from "@/lib/db/seed";
import { accounts, recurring, recurringPayments } from "@/lib/db/schema";
import { canAfford, currentPeriod, forecastFor, isDue, monthRecurring } from "@/lib/forecast";
import { createAccount, updateAccount } from "@/lib/queries/accounts";
import { listRecurring } from "@/lib/queries/recurring";
import { createTransaction, deleteTransaction } from "@/lib/queries/transactions";
import { getForecastMargin, setForecastMargin } from "@/lib/settings";
import { recurringInput } from "@/lib/validation";

type Db = ReturnType<typeof createDb>;

const r = (frequency: "monthly" | "quarterly" | "yearly", anchorMonth: number | null, active = true) => ({
  frequency,
  anchorMonth,
  active,
});

describe("isDue", () => {
  it("mensuelle : toujours due", () => {
    for (const p of ["2026-01", "2026-06", "2026-12"]) expect(isDue(r("monthly", null), p)).toBe(true);
  });
  it("trimestrielle ancrée en novembre : novembre, février, mai, août", () => {
    const q = r("quarterly", 11);
    expect(isDue(q, "2026-11")).toBe(true);
    expect(isDue(q, "2027-02")).toBe(true);
    expect(isDue(q, "2026-12")).toBe(false);
    expect(isDue(q, "2026-10")).toBe(false);
  });
  it("annuelle ancrée en janvier : seulement janvier", () => {
    const y = r("yearly", 1);
    expect(isDue(y, "2027-01")).toBe(true);
    expect(isDue(y, "2026-12")).toBe(false);
    expect(isDue(y, "2027-02")).toBe(false);
  });
  it("inactive : jamais due", () => {
    expect(isDue(r("monthly", null, false), "2026-10")).toBe(false);
  });
});

describe("currentPeriod", () => {
  it("extrait le mois d'une date", () => {
    expect(currentPeriod("2026-10-26")).toBe("2026-10");
  });
});

describe("canAfford", () => {
  it("oui : il reste plus que la marge", () => {
    expect(canAfford(115_000, 20_000, 40_000)).toEqual({ ok: true, remaining: 75_000, missing: 0 });
  });
  it("non : il manque de quoi garder la marge", () => {
    expect(canAfford(30_000, 20_000, 20_000)).toEqual({ ok: false, remaining: 10_000, missing: 10_000 });
  });
  it("marge 0 : ok jusqu'à zéro", () => {
    expect(canAfford(10_000, 0, 10_000)).toEqual({ ok: true, remaining: 0, missing: 0 });
    expect(canAfford(10_000, 0, 10_001)).toEqual({ ok: false, remaining: -1, missing: 1 });
  });
});

describe("prévision", () => {
  let db: Db;
  let c1: number;
  let c2: number;
  let livret: number;
  const P = "2026-10";

  const add = (label: string, amount: number, accountId: number, extra: Partial<typeof recurring.$inferInsert> = {}) =>
    db
      .insert(recurring)
      .values({ label, amount, accountId, frequency: "monthly", anchorMonth: null, ...extra })
      .returning()
      .get()!;

  beforeEach(() => {
    db = createDb(":memory:");
    runMigrations(db);
    seedDefaults(db);
    db.delete(accounts).run();
    c1 = createAccount(db, { name: "Courant A", type: "checking", initialBalance: 100_000 }).id;
    c2 = createAccount(db, { name: "Courant B", type: "checking", initialBalance: 20_000 }).id;
    livret = createAccount(db, { name: "Livret", type: "savings", initialBalance: 500_000 }).id;
  });

  it("cas du brief : 120 000 de solde courant, 5 000 dû, prévision 115 000", () => {
    const due = add("Loyer", 5_000, c1);
    const paid = add("Payée", 3_000, c1);
    const skipped = add("Passée", 2_000, c1);
    const onSavings = add("Sur le livret", 4_000, livret);
    // Opération de 0 : la ligne de paiement existe sans modifier le solde de référence.
    const tx = createTransaction(db, { accountId: c1, categoryId: null, date: "2026-10-05", amount: 0, label: "Payée" });
    db.insert(recurringPayments).values({ recurringId: paid.id, period: P, transactionId: tx.id }).run();
    db.insert(recurringPayments).values({ recurringId: skipped.id, period: P, skipped: true }).run();

    const f = forecastFor(db, P);
    expect(f.checkingBalance).toBe(120_000);
    expect(f.dueTotal).toBe(5_000);
    expect(f.forecast).toBe(115_000);
    expect(f.margin).toBe(20_000);
    expect(f.items.find((i) => i.id === due.id)).toMatchObject({ status: "due", inForecast: true });
    expect(f.items.find((i) => i.id === onSavings.id)).toMatchObject({ status: "due", inForecast: false });
  });

  it("statuts et noms dans monthRecurring ; inactives et non dues exclues", () => {
    const due = add("Loyer", 5_000, c1);
    const paid = add("Salle de sport", 3_000, c1);
    const skipped = add("Magazine", 2_000, c2);
    add("En pause", 900, c1, { active: false });
    add("Annuelle en janvier", 900, c1, { frequency: "yearly", anchorMonth: 1 });
    const tx = createTransaction(db, { accountId: c1, categoryId: null, date: "2026-10-05", amount: -3_000, label: "Salle de sport" });
    db.insert(recurringPayments).values({ recurringId: paid.id, period: P, transactionId: tx.id }).run();
    db.insert(recurringPayments).values({ recurringId: skipped.id, period: P, skipped: true }).run();

    const items = monthRecurring(db, P);
    expect(items.map((i) => i.label).sort()).toEqual(["Loyer", "Magazine", "Salle de sport"]);
    const by = (id: number) => items.find((i) => i.id === id)!;
    expect(by(due.id)).toMatchObject({ status: "due", transactionId: null, accountName: "Courant A", categoryName: null });
    expect(by(paid.id)).toMatchObject({ status: "paid", transactionId: tx.id });
    expect(by(skipped.id)).toMatchObject({ status: "skipped", transactionId: null });
  });

  it("exclut un compte courant archivé", () => {
    add("Loyer", 5_000, c2);
    updateAccount(db, c2, { archived: true });
    const f = forecastFor(db, P);
    expect(f.checkingBalance).toBe(100_000);
    expect(f.dueTotal).toBe(0);
    expect(f.items[0].inForecast).toBe(false);
  });

  it("supprimer l'opération d'un paiement remet la récurrente à payer", () => {
    const paid = add("Salle de sport", 3_000, c1);
    const tx = createTransaction(db, { accountId: c1, categoryId: null, date: "2026-10-05", amount: -3_000, label: "Salle de sport" });
    db.insert(recurringPayments).values({ recurringId: paid.id, period: P, transactionId: tx.id }).run();
    expect(monthRecurring(db, P)[0].status).toBe("paid");
    deleteTransaction(db, tx.id);
    expect(db.select().from(recurringPayments).all()).toEqual([]);
    expect(monthRecurring(db, P)[0].status).toBe("due");
  });

  it("listRecurring renvoie toutes les récurrentes, pausées comprises", () => {
    add("A", 100, c1);
    add("B", 200, c1, { active: false });
    expect(listRecurring(db).map((x) => x.label)).toEqual(["A", "B"]);
  });
});

describe("marge de sécurité", () => {
  it("200 € par défaut, modifiable, jamais négative", () => {
    const db = createDb(":memory:");
    runMigrations(db);
    expect(getForecastMargin(db)).toBe(20_000);
    setForecastMargin(db, 0);
    expect(getForecastMargin(db)).toBe(0);
    setForecastMargin(db, 5_000);
    expect(getForecastMargin(db)).toBe(5_000);
    expect(() => setForecastMargin(db, -1)).toThrow();
  });
});

describe("recurringInput", () => {
  const base = { label: "Loyer", amount: 50_000, categoryId: null, accountId: 1 };
  it("mensuelle sans mois ; les autres exigent un mois", () => {
    expect(recurringInput.safeParse({ ...base, frequency: "monthly", anchorMonth: null }).success).toBe(true);
    expect(recurringInput.safeParse({ ...base, frequency: "monthly", anchorMonth: 3 }).success).toBe(false);
    expect(recurringInput.safeParse({ ...base, frequency: "quarterly", anchorMonth: null }).success).toBe(false);
    expect(recurringInput.safeParse({ ...base, frequency: "yearly", anchorMonth: 12 }).success).toBe(true);
    expect(recurringInput.safeParse({ ...base, frequency: "yearly", anchorMonth: 13 }).success).toBe(false);
  });
  it("borne le libellé et le montant", () => {
    expect(recurringInput.safeParse({ ...base, label: "", frequency: "monthly", anchorMonth: null }).success).toBe(false);
    expect(recurringInput.safeParse({ ...base, amount: 0, frequency: "monthly", anchorMonth: null }).success).toBe(false);
    expect(recurringInput.safeParse({ ...base, amount: 1.5, frequency: "monthly", anchorMonth: null }).success).toBe(false);
  });
});
