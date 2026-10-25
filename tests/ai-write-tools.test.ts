import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { runAlertChecks } = vi.hoisted(() => ({ runAlertChecks: vi.fn(async () => {}) }));
vi.mock("@/lib/alerts/engine", () => ({ runAlertChecks }));

import { aiActions, accounts, categories, goals, holdings, transactions } from "@/lib/db/schema";
import { createDb, type Db } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { seedDefaults } from "@/lib/db/seed";
import { actionStatus, undoAction, type Change } from "@/lib/ai/actions";
import { aiTools, runTool } from "@/lib/ai/tools";
import { formatEUR } from "@/lib/money";
import { categoryInput, goalInput, holdingInput } from "@/lib/validation";
import { CATEGORY_ICON_NAMES } from "@/lib/category-icon-names";
import { CATEGORY_ICON_NAMES as UI_ICON_NAMES } from "@/components/category-icon";
import {
  MAX_WRITES_PER_RESPONSE,
  WRITE_TOOL_NAMES,
  resolveAccount,
  resolveCategory,
  runWriteTool,
  toolIssueMessage,
  writeTools,
} from "@/lib/ai/write-tools";

const TODAY = "2026-10-26";
let db: Db;
let checkingId: number;

beforeEach(() => {
  runAlertChecks.mockClear();
  db = createDb(":memory:");
  runMigrations(db);
  seedDefaults(db);
  checkingId = db.select().from(accounts).get()!.id;
});

const ctx = (remaining = MAX_WRITES_PER_RESPONSE) => ({ today: TODAY, budget: { remaining } });
const catId = (name: string) => db.select().from(categories).where(eq(categories.name, name)).get()!.id;
const txRow = (id: number) => db.select().from(transactions).where(eq(transactions.id, id)).get();
const changesOf = (actionId: number): Change[] =>
  JSON.parse(db.select().from(aiActions).where(eq(aiActions.id, actionId)).get()!.changes) as Change[];
const actionCount = () => db.select().from(aiActions).all().length;

function addTx(label: string, amount: number, categoryId: number | null = null, date = "2026-10-01") {
  return db.insert(transactions).values({ accountId: checkingId, date, amount, label, categoryId }).returning().get();
}

type Ok = { ok: true; summary: string; [k: string]: unknown };
type Err = { error: string };

async function run(name: string, input: unknown, c = ctx()) {
  return runWriteTool(db, name, input, c) as Promise<{ result: Ok | Err; actionId?: number }>;
}

function expectError(out: { result: Ok | Err; actionId?: number }, pattern?: RegExp) {
  expect(out.actionId).toBeUndefined();
  expect("error" in out.result).toBe(true);
  if (pattern) expect((out.result as Err).error).toMatch(pattern);
}

describe("définitions", () => {
  it("expose les outils de la spécification, sans doublon avec la lecture", () => {
    expect(writeTools.map((t) => t.name).sort()).toEqual(
      [
        "add_holding",
        "add_transaction",
        "archive_account",
        "create_account",
        "create_category",
        "create_goal",
        "delete_goal",
        "delete_holding",
        "delete_transaction",
        "recategorize_transactions",
        "rename_account",
        "rename_category",
        "set_budget",
        "update_goal",
        "update_holding",
        "update_transaction",
      ].sort(),
    );
    expect([...WRITE_TOOL_NAMES].sort()).toEqual(writeTools.map((t) => t.name).sort());
    for (const t of writeTools) {
      expect(t.description!.length).toBeGreaterThan(40);
      expect(t.input_schema.type).toBe("object");
      expect(aiTools.some((r) => r.name === t.name)).toBe(false);
    }
    expect(writeTools.some((t) => /delete_account|delete_category/.test(t.name))).toBe(false);
  });

  it("outil inconnu → erreur, sans consommer le plafond", async () => {
    const c = ctx();
    expectError(await run("delete_account", { id: 1 }, c));
    expect(c.budget.remaining).toBe(MAX_WRITES_PER_RESPONSE);
  });
});

describe("résolution par nom", () => {
  it("catégorie : casse, accents et espaces ignorés", () => {
    expect(resolveCategory(db, { name: "  sante " })).toMatchObject({ category: { id: catId("Santé") } });
    expect(resolveCategory(db, { name: "ALIMENTATION" }, "expense")).toMatchObject({ category: { name: "Alimentation" } });
    expect(resolveCategory(db, { id: catId("Loisirs") })).toMatchObject({ category: { name: "Loisirs" } });
  });

  it("catégorie : introuvable, ambiguë, mauvais sens", () => {
    const unknown = resolveCategory(db, { name: "Inexistante" });
    expect("error" in unknown && unknown.error).toMatch(/introuvable/i);
    db.insert(categories).values({ name: "Santé", kind: "income", color: "#000000", icon: "circle" }).run();
    const ambiguous = resolveCategory(db, { name: "sante" });
    expect("error" in ambiguous && ambiguous.error).toMatch(/plusieurs/i);
    // Le sens lève l'ambiguïté.
    expect(resolveCategory(db, { name: "sante" }, "expense")).toMatchObject({ category: { kind: "expense" } });
    const wrongKind = resolveCategory(db, { name: "Salaire" }, "expense");
    expect("error" in wrongKind && wrongKind.error).toMatch(/revenus/i);
    const badId = resolveCategory(db, { id: 9999 });
    expect("error" in badId && badId.error).toMatch(/introuvable/i);
  });

  it("compte : nom exact normalisé, ambiguïté", () => {
    db.insert(accounts).values({ name: "Livret Été", type: "savings" }).run();
    expect(resolveAccount(db, { name: "livret ete" })).toMatchObject({ account: { name: "Livret Été" } });
    db.insert(accounts).values({ name: "LIVRET ETE", type: "savings" }).run();
    const amb = resolveAccount(db, { name: "Livret été" });
    expect("error" in amb && amb.error).toMatch(/plusieurs/i);
    const none = resolveAccount(db, { name: "Livret" });
    expect("error" in none && none.error).toMatch(/introuvable/i);
  });
});

describe("opérations", () => {
  it("add_transaction : euros → centimes, dépense négative, journal exact", async () => {
    const out = await run("add_transaction", { amount: 12.3, kind: "expense", label: "Boulangerie", category: "alimentation" });
    expect(out.actionId).toEqual(expect.any(Number));
    const res = out.result as Ok & { transaction: { id: number; amount: number } };
    expect(res.summary).toBe(`Opération ajoutée : Boulangerie −${formatEUR(1230)}`);
    const row = txRow(res.transaction.id)!;
    expect(row).toMatchObject({ amount: -1230, date: TODAY, accountId: checkingId, categoryId: catId("Alimentation") });
    expect(res.transaction.amount).toBe(-12.3);
    expect(changesOf(out.actionId!)).toEqual([{ table: "transactions", id: row.id, before: null, after: row }]);
    expect(runAlertChecks).toHaveBeenCalledWith(db, { txIds: [row.id], goals: true });
  });

  it("add_transaction : revenu positif, compte par défaut = courant non archivé", async () => {
    db.update(accounts).set({ type: "savings" }).where(eq(accounts.id, checkingId)).run();
    const other = db.insert(accounts).values({ name: "Joint", type: "checking" }).returning().get();
    const out = await run("add_transaction", { amount: 2000, kind: "income", label: "Salaire", date: "2026-10-25", category: "Salaire" });
    const row = txRow((out.result as Ok & { transaction: { id: number } }).transaction.id)!;
    expect(row).toMatchObject({ amount: 200_000, accountId: other.id, date: "2026-10-25" });
  });

  it("add_transaction : erreurs sans écriture", async () => {
    expectError(await run("add_transaction", { amount: 12, kind: "expense", label: "X", category: "Salaire" }), /revenus/);
    expectError(await run("add_transaction", { amount: 12.345, kind: "expense", label: "X" }));
    expectError(await run("add_transaction", { amount: -5, kind: "expense", label: "X" }));
    expectError(await run("add_transaction", { amount: 5, kind: "expense", label: "X", date: "2026-02-30" }));
    expectError(await run("add_transaction", { amount: 5, kind: "expense", label: "X", account: "Inconnu" }), /introuvable/i);
    expectError(await run("add_transaction", { amount: 5, kind: "expense", label: "X", extra: 1 }));
    expect(db.select().from(transactions).all()).toEqual([]);
    expect(actionCount()).toBe(0);
  });

  it("update_transaction : montant, sens et catégorie ; journal avant/après", async () => {
    const before = addTx("Resto", -2500, catId("Restaurants"));
    const out = await run("update_transaction", { id: before.id, amount: 30, label: "Restaurant" });
    const after = txRow(before.id)!;
    expect(after).toMatchObject({ amount: -3000, label: "Restaurant" });
    expect(changesOf(out.actionId!)).toEqual([{ table: "transactions", id: before.id, before, after }]);
    expect((out.result as Ok).summary).toMatch(/^Opération modifiée : Restaurant/);
    expect(runAlertChecks).toHaveBeenCalledWith(db, { txIds: [before.id], goals: true, expenseRule: false });

    // Changer de sens avec une catégorie de dépense restante → erreur.
    expectError(await run("update_transaction", { id: before.id, kind: "income" }), /catégorie/i);
    const ok = await run("update_transaction", { id: before.id, kind: "income", category: "Autres revenus" });
    expect(txRow(before.id)).toMatchObject({ amount: 3000, categoryId: catId("Autres revenus") });
    expect(ok.actionId).toBeDefined();

    const clear = await run("update_transaction", { id: before.id, uncategorized: true, note: "remboursement" });
    expect(txRow(before.id)).toMatchObject({ categoryId: null, note: "remboursement" });
    expect(clear.actionId).toBeDefined();

    expectError(await run("update_transaction", { id: 9999, label: "X" }), /introuvable/i);
    expectError(await run("update_transaction", { id: before.id }), /aucune modification/i);
  });

  it("delete_transaction : une seule, journal et annulation", async () => {
    const before = addTx("Café", -250);
    const out = await run("delete_transaction", { id: before.id });
    expect(txRow(before.id)).toBeUndefined();
    expect(changesOf(out.actionId!)).toEqual([{ table: "transactions", id: before.id, before, after: null }]);
    expect((out.result as Ok).summary).toContain("Café");
    expect(undoAction(db, out.actionId!).ok).toBe(true);
    expect(txRow(before.id)).toEqual(before);
    expectError(await run("delete_transaction", { ids: [before.id] }));
  });
});

describe("recategorize_transactions", () => {
  it("filtre par libellé (casse, accents), ignore celles déjà dans la cible", async () => {
    const a = addTx("AMAZON EU", -1000, catId("Autres"));
    const b = addTx("Amazon Prime", -699, null);
    const c = addTx("amazon marketplace", -2000, catId("Shopping"));
    addTx("Carrefour", -3000, catId("Alimentation"));
    const out = await run("recategorize_transactions", { q: "amazon", target_category: "shopping" });
    expect((out.result as Ok).summary).toBe("2 opérations recatégorisées en Shopping");
    const changes = changesOf(out.actionId!);
    expect(changes.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
    expect(changes.find((x) => x.id === a.id)).toEqual({ table: "transactions", id: a.id, before: a, after: txRow(a.id) });
    expect(txRow(b.id)!.categoryId).toBe(catId("Shopping"));
    expect(txRow(c.id)).toEqual(c);
    expect(runAlertChecks).toHaveBeenCalledWith(db, { txIds: expect.arrayContaining([a.id, b.id]), goals: true, expenseRule: false });
    expect(undoAction(db, out.actionId!).ok).toBe(true);
    expect(txRow(a.id)).toEqual(a);
    expect(txRow(b.id)).toEqual(b);
  });

  it("filtres période, catégorie source, sans catégorie", async () => {
    const sept = addTx("Uber", -1500, catId("Autres"), "2026-09-10");
    const oct = addTx("Uber", -1500, catId("Autres"), "2026-10-10");
    const none = addTx("Uber Eats", -1800, null, "2026-10-12");
    const one = await run("recategorize_transactions", { from: "2026-10-01", to: "2026-10-31", category: "Autres", target_category: "Transport" });
    expect((one.result as Ok).summary).toBe("1 opération recatégorisée en Transport");
    expect(txRow(oct.id)!.categoryId).toBe(catId("Transport"));
    expect(txRow(sept.id)!.categoryId).toBe(catId("Autres"));
    await run("recategorize_transactions", { uncategorized: true, target_category: "Restaurants" });
    expect(txRow(none.id)!.categoryId).toBe(catId("Restaurants"));
  });

  it("erreurs : aucun filtre, aucune, sens incompatible, plus de 200", async () => {
    addTx("Remboursement Amazon", 1000);
    addTx("Amazon", -1000);
    expectError(await run("recategorize_transactions", { target_category: "Shopping" }), /filtre/i);
    expectError(await run("recategorize_transactions", { q: "zzz", target_category: "Shopping" }), /^Aucune opération ne correspond\.$/);
    expectError(
      await run("recategorize_transactions", { q: "amazon", target_category: "Shopping" }),
      /ne correspond pas au sens de 1 opération/,
    );
    // Avec le filtre de sens, ça passe.
    expect((await run("recategorize_transactions", { q: "amazon", kind: "expense", target_category: "Shopping" })).actionId).toBeDefined();

    db.insert(transactions)
      .values(Array.from({ length: 201 }, (_, i) => ({ accountId: checkingId, date: "2026-10-02", amount: -100 - i, label: `Lot ${i}` })))
      .run();
    const before = actionCount();
    expectError(await run("recategorize_transactions", { q: "lot", target_category: "Loisirs" }), /Trop d'opérations \(201\)/);
    expect(actionCount()).toBe(before);
    expect(db.select().from(transactions).where(eq(transactions.categoryId, catId("Loisirs"))).all()).toEqual([]);
  });
});

describe("budgets et catégories", () => {
  it("set_budget : fixe puis retire ; dépenses uniquement ; pas d'alerte", async () => {
    const id = catId("Loisirs");
    const before = db.select().from(categories).where(eq(categories.id, id)).get()!;
    const out = await run("set_budget", { category: "loisirs", amount: 150 });
    expect((out.result as Ok).summary).toBe(`Budget Loisirs fixé à ${formatEUR(15_000)}`);
    const after = db.select().from(categories).where(eq(categories.id, id)).get()!;
    expect(after.monthlyBudget).toBe(15_000);
    expect(changesOf(out.actionId!)).toEqual([{ table: "categories", id, before, after }]);
    const removed = await run("set_budget", { category_id: id, amount: null });
    expect((removed.result as Ok).summary).toBe("Budget Loisirs retiré");
    expect(db.select().from(categories).where(eq(categories.id, id)).get()!.monthlyBudget).toBeNull();
    expectError(await run("set_budget", { category: "Salaire", amount: 100 }), /revenus/);
    expect(runAlertChecks).not.toHaveBeenCalled();
  });

  it("set_budget sans changement : pas d'action journalisée", async () => {
    const out = await run("set_budget", { category: "Loisirs", amount: null });
    expect(out.actionId).toBeUndefined();
    expect((out.result as Ok).ok).toBe(true);
    expect(actionCount()).toBe(0);
  });

  it("create_category et rename_category", async () => {
    const out = await run("create_category", { name: "Animaux", kind: "expense" });
    const created = db.select().from(categories).where(eq(categories.name, "Animaux")).get()!;
    expect(created).toMatchObject({ kind: "expense", icon: "circle-ellipsis" });
    expect(created.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(changesOf(out.actionId!)).toEqual([{ table: "categories", id: created.id, before: null, after: created }]);
    expectError(await run("create_category", { name: "animaux", kind: "expense" }), /existe déjà/);

    const renamed = await run("rename_category", { category: "Animaux", name: "Animaux de compagnie" });
    expect((renamed.result as Ok).summary).toBe("Catégorie Animaux renommée en Animaux de compagnie");
    expect(db.select().from(categories).where(eq(categories.id, created.id)).get()!.name).toBe("Animaux de compagnie");
    expectError(await run("rename_category", { category: "Loisirs", name: "Shopping" }), /existe déjà/);
  });
});

describe("objectifs", () => {
  it("create_goal, update_goal, delete_goal", async () => {
    const out = await run("create_goal", { name: "Vacances", target: 2000, deadline: "2027-06-30" });
    expect((out.result as Ok).summary).toBe(`Objectif Vacances créé (${formatEUR(200_000)})`);
    const g = db.select().from(goals).get()!;
    expect(g).toMatchObject({ targetAmount: 200_000, deadline: "2027-06-30", accountId: null });
    expect(changesOf(out.actionId!)).toEqual([{ table: "goals", id: g.id, before: null, after: g }]);
    expect(runAlertChecks).toHaveBeenCalledWith(db, { goals: true });

    const upd = await run("update_goal", { id: g.id, target: 2500.5, account: "Compte courant", current_amount: 10 });
    const after = db.select().from(goals).get()!;
    expect(after).toMatchObject({ targetAmount: 250_050, accountId: checkingId, currentAmount: 1000 });
    expect(changesOf(upd.actionId!)).toEqual([{ table: "goals", id: g.id, before: g, after }]);
    await run("update_goal", { id: g.id, account_id: null, deadline: null });
    expect(db.select().from(goals).get()).toMatchObject({ accountId: null, deadline: null });

    const del = await run("delete_goal", { id: g.id });
    expect((del.result as Ok).summary).toBe("Objectif Vacances supprimé");
    expect(db.select().from(goals).all()).toEqual([]);
    expectError(await run("delete_goal", { id: g.id }), /introuvable/i);
  });
});

describe("comptes", () => {
  it("create_account, rename_account, archive_account (pas de suppression)", async () => {
    const out = await run("create_account", { name: "Livret A", type: "savings", initial_balance: 1500.5 });
    const acc = db.select().from(accounts).where(eq(accounts.name, "Livret A")).get()!;
    expect(acc.initialBalance).toBe(150_050);
    expect(changesOf(out.actionId!)).toEqual([{ table: "accounts", id: acc.id, before: null, after: acc }]);
    expectError(await run("create_account", { name: "livret a", type: "savings" }), /existe déjà/);

    await run("rename_account", { account: "Livret A", name: "Livret A Banque" });
    expect(db.select().from(accounts).where(eq(accounts.id, acc.id)).get()!.name).toBe("Livret A Banque");

    const arch = await run("archive_account", { account_id: acc.id });
    expect((arch.result as Ok).summary).toBe("Compte Livret A Banque archivé");
    expect(db.select().from(accounts).where(eq(accounts.id, acc.id)).get()!.archived).toBe(true);
    expect(runAlertChecks).toHaveBeenCalledWith(db, { goals: true });
    const unarch = await run("archive_account", { account_id: acc.id, archived: false });
    expect((unarch.result as Ok).summary).toBe("Compte Livret A Banque désarchivé");

    // Pas de nouvelle opération sur un compte archivé.
    await run("archive_account", { account_id: acc.id });
    expectError(await run("add_transaction", { amount: 5, kind: "expense", label: "X", account_id: acc.id }), /archivé/);
  });
});

describe("positions", () => {
  it("add_holding : prix unitaires en euros → centimes réels", async () => {
    const out = await run("add_holding", {
      account: "Compte courant",
      symbol: "btc",
      name: "Bitcoin",
      asset_type: "crypto",
      quantity: 0.015,
      avg_price: 0.00001234,
    });
    const h = db.select().from(holdings).get()!;
    expect(h).toMatchObject({ symbol: "BTC", quantity: 0.015, avgPrice: 0.001234, manualPrice: null });
    expect(changesOf(out.actionId!)).toEqual([{ table: "holdings", id: h.id, before: null, after: h }]);
    expect((out.result as Ok).summary).toBe("Position BTC ajoutée");
    expect(runAlertChecks).toHaveBeenCalledWith(db, { goals: true });

    const upd = await run("update_holding", { id: h.id, quantity: 0.02, manual_price: 100 });
    expect((upd.result as Ok).summary).toBe("Position BTC modifiée");
    const after = db.select().from(holdings).get()!;
    expect(after).toMatchObject({ quantity: 0.02, manualPrice: 10_000 });
    expect(changesOf(upd.actionId!)).toEqual([{ table: "holdings", id: h.id, before: h, after }]);

    const del = await run("delete_holding", { id: h.id });
    expect((del.result as Ok).summary).toBe("Position BTC supprimée");
    expect(db.select().from(holdings).all()).toEqual([]);
    expectError(await run("update_holding", { id: h.id, quantity: 1 }), /introuvable/i);
  });
});

describe("plafond par réponse", () => {
  it("décrémente à chaque tentative et refuse au-delà de 20", async () => {
    const c = ctx();
    for (let i = 0; i < MAX_WRITES_PER_RESPONSE; i++) {
      await run("add_transaction", { amount: 1, kind: "expense", label: `T${i}` }, c);
    }
    expect(c.budget.remaining).toBe(0);
    const out = await run("add_transaction", { amount: 1, kind: "expense", label: "Trop" }, c);
    expectError(out, /Limite de 20 modifications par réponse atteinte\./);
    expect(db.select().from(transactions).all()).toHaveLength(MAX_WRITES_PER_RESPONSE);

    const c2 = ctx(1);
    await run("add_transaction", { amount: 1.234, kind: "expense", label: "Invalide" }, c2);
    expect(c2.budget.remaining).toBe(0);
  });
});

describe("outils de lecture : identifiants exposés", () => {
  it("search_transactions, get_goals, get_holdings et get_overview renvoient les ids", async () => {
    const tx = addTx("Café", -250, catId("Restaurants"));
    db.insert(goals).values({ name: "Vacances", targetAmount: 1000 }).run();
    db.insert(holdings).values({ accountId: checkingId, symbol: "CW8", name: "MSCI", assetType: "etf", quantity: 1, avgPrice: 100 }).run();
    const s = (await runTool(db, "search_transactions", {}, TODAY)) as { transactions: { id: number; category_id: number | null; account_id: number }[] };
    expect(s.transactions[0]).toMatchObject({ id: tx.id, category_id: catId("Restaurants"), account_id: checkingId });
    const g = (await runTool(db, "get_goals", {}, TODAY)) as { goals: { id: number }[] };
    expect(g.goals[0].id).toEqual(expect.any(Number));
    const h = (await runTool(db, "get_holdings", {}, TODAY)) as { holdings: { id: number }[] };
    expect(h.holdings[0].id).toEqual(expect.any(Number));
    const o = (await runTool(db, "get_overview", {}, TODAY)) as { accounts: { id: number }[] };
    expect(o.accounts[0].id).toBe(checkingId);
  });

  it("l'état d'annulation reste cohérent après une écriture", async () => {
    const out = await run("add_transaction", { amount: 3, kind: "expense", label: "Kiosque" });
    expect(actionStatus(db, out.actionId!).undoable).toBe(true);
  });
});

describe("corrections de revue", () => {
  it("rien n'a changé → résumé neutre, aucune action", async () => {
    await run("set_budget", { category: "Loisirs", amount: 150 });
    const out = await run("set_budget", { category: "Loisirs", amount: 150 });
    expect(out.actionId).toBeUndefined();
    expect(out.result).toMatchObject({ ok: true, unchanged: true });
    expect((out.result as Ok).summary).toBe("Aucun changement : les valeurs demandées sont déjà en place.");
  });

  it("prix unitaire ou quantité démesurés → refusés à l'entrée, champ en snake_case", async () => {
    for (const input of [
      { account_id: checkingId, symbol: "X", name: "X", asset_type: "etf", quantity: 1, avg_price: 1e308 },
      { account_id: checkingId, symbol: "X", name: "X", asset_type: "etf", quantity: 1e300, avg_price: 1 },
      { account_id: checkingId, symbol: "X", name: "X", asset_type: "etf", quantity: 1, avg_price: 1, manual_price: 1e308 },
    ]) {
      const out = await run("add_holding", input);
      expectError(out, /Paramètres invalides \((avg_price|quantity|manual_price)\)/);
      expect((out.result as Err).error).not.toMatch(/Infinity|avgPrice|manualPrice/);
    }
    expect(db.select().from(holdings).all()).toHaveLength(0);
  });

  it("erreur d'un schéma interne → chemin traduit en nom de champ de l'outil", () => {
    const err = holdingInput.safeParse({ accountId: 0, symbol: "X", name: "X", assetType: "etf", quantity: 1, avgPrice: -1 }).error!;
    expect(toolIssueMessage(err)).toMatch(/^Paramètres invalides \((account_id|avg_price)\)/);
    const goal = goalInput.safeParse({ name: "X", targetAmount: 0 }).error!;
    expect(toolIssueMessage(goal)).toMatch(/^Paramètres invalides \(target\)/);
    const budget = categoryInput.partial().safeParse({ monthlyBudget: -1 }).error!;
    expect(toolIssueMessage(budget)).toMatch(/^Paramètres invalides \(amount\)/);
  });

  it("icônes de catégorie : liste de l'interface", () => {
    const def = writeTools.find((t) => t.name === "create_category")!;
    const icon = (def.input_schema.properties as Record<string, { enum: string[] }>).icon;
    expect(icon.enum).toEqual([...CATEGORY_ICON_NAMES]);
    expect([...UI_ICON_NAMES]).toEqual([...CATEGORY_ICON_NAMES]);
  });

  it("write-tools n'importe aucun module d'interface (lucide-react)", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../src/lib/ai/write-tools.ts"), "utf8");
    expect(src).not.toMatch(/@\/components\//);
  });

  it("get_overview liste toutes les catégories avec id, sens et budget", async () => {
    const o = (await runTool(db, "get_overview", {}, TODAY)) as {
      categories: { id: number; name: string; kind: string; budget: number | null }[];
    };
    const all = db.select().from(categories).all();
    expect(o.categories).toHaveLength(all.length);
    expect(o.categories.find((c) => c.name === "Salaire")).toMatchObject({ id: catId("Salaire"), kind: "income", budget: null });
    await run("set_budget", { category: "Loisirs", amount: 321.5 });
    const o2 = (await runTool(db, "get_overview", {}, TODAY)) as typeof o;
    expect(o2.categories.find((c) => c.name === "Loisirs")).toMatchObject({ kind: "expense", budget: 321.5 });
  });
});
