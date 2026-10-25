import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { seedDefaults } from "@/lib/db/seed";
import { accounts, alertLog, categories, goals, holdings, messages, prices } from "@/lib/db/schema";
import { budgetAlerts, goalReachedAlerts, priceMoveAlerts, unusualExpense } from "@/lib/alerts/rules";
import { alertMessage, claimAlerts, runAlertChecks } from "@/lib/alerts/engine";
import { createTransaction, insertTransactions } from "@/lib/queries/transactions";
import { refreshPrices, type PriceFetcher } from "@/lib/prices";
import { registerChannel } from "@/lib/assistant/dispatch";
import { setSetting } from "@/lib/settings";
import type { Ai } from "@/lib/ai/client";
import * as conversation from "@/lib/assistant/conversation";

function freshDb() {
  const db = createDb(":memory:");
  runMigrations(db);
  seedDefaults(db);
  return db;
}
type TestDb = ReturnType<typeof freshDb>;

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  vi.restoreAllMocks();
});

function account(db: TestDb) {
  return db.select().from(accounts).get()!;
}
function expenseCat(db: TestDb, budget: number | null) {
  const c = db.select().from(categories).where(eq(categories.kind, "expense")).get()!;
  db.update(categories).set({ monthlyBudget: budget }).where(eq(categories.id, c.id)).run();
  return c;
}
function fakeAi(text: string | Error) {
  const create = vi.fn(async (params: unknown) => {
    void params;
    if (text instanceof Error) throw text;
    return { content: [{ type: "text", text }] };
  });
  return { ai: { client: { messages: { create } }, model: "claude-opus-5-5" } as unknown as Ai, create };
}

describe("budgetAlerts", () => {
  const line = (spent: number) => ({ categoryId: 3, name: "Alimentation", budget: 45_000, spent });
  const run = (spent: number, claimed: string[] = []) =>
    budgetAlerts({ month: "2026-10", lines: [line(spent)], claimed: new Set(claimed) });

  it("rien sous 80 %", () => expect(run(35_999)).toEqual([]));
  it("80 % atteint", () => {
    const [a] = run(36_000);
    expect(a).toMatchObject({ key: "budget:3:2026-10:80", type: "budget80" });
    expect(a.facts.category).toBe("Alimentation");
  });
  it("dépassement strict à 100 %", () => {
    expect(run(45_000)[0].type).toBe("budget80");
    const [a] = run(45_001);
    expect(a).toMatchObject({ key: "budget:3:2026-10:100", type: "budget100", extraKeys: ["budget:3:2026-10:80"] });
  });
  it("ne ré-émet pas un seuil déjà réclamé", () => {
    expect(run(37_000, ["budget:3:2026-10:80"])).toEqual([]);
    expect(run(46_000, ["budget:3:2026-10:100"])).toEqual([]);
    expect(run(37_000, ["budget:3:2026-10:100"])).toEqual([]);
    expect(run(46_000, ["budget:3:2026-10:80"])[0].type).toBe("budget100");
  });
});

describe("unusualExpense", () => {
  const tx = (o: Partial<{ id: number; amount: number; median: number | null; samples: number }> = {}) => ({
    id: 1,
    label: "Boutique",
    categoryName: "Loisirs",
    amount: 30_000,
    median: 5_000 as number | null,
    samples: 6,
    ...o,
  });
  const run = (t: ReturnType<typeof tx>, minCents = 10_000) => unusualExpense({ transactions: [t], minCents });

  it("≥ 5 échantillons : seuil mini ET 3 × médiane", () => {
    expect(run(tx())[0]).toMatchObject({ key: "expense:1", type: "expense" });
    expect(run(tx({ amount: 14_999 }))).toEqual([]);
    expect(run(tx({ amount: 15_000, median: 5_000 }))).toHaveLength(1);
    expect(run(tx({ amount: 9_000, median: 100 }))).toEqual([]);
  });
  it("< 5 échantillons : seuil mini × 2", () => {
    expect(run(tx({ samples: 4, median: null, amount: 19_999 }))).toEqual([]);
    expect(run(tx({ samples: 0, median: null, amount: 20_000 }))).toHaveLength(1);
  });
});

describe("priceMoveAlerts", () => {
  const move = (changePct: number) => ({ symbol: "AAPL", name: "Apple", changePct, priceCents: 20_000, valueCents: 40_000 });
  const run = (pct: number, threshold = 5) =>
    priceMoveAlerts({ moves: [move(pct)], thresholdPct: threshold, date: "2026-10-25" });

  it("hausse et baisse au-delà du seuil", () => {
    expect(run(5)[0]).toMatchObject({ key: "price:AAPL:2026-10-25:up", type: "price" });
    expect(run(-7.5)[0].key).toBe("price:AAPL:2026-10-25:down");
  });
  it("rien sous le seuil", () => expect(run(4.99)).toEqual([]));
});

describe("goalReachedAlerts", () => {
  it("objectif atteint seulement", () => {
    const alerts = goalReachedAlerts({
      goals: [
        { id: 1, name: "Vacances", target: 100_000, current: 100_000, pct: 1 },
        { id: 2, name: "Voiture", target: 100_000, current: 50_000, pct: 0.5 },
      ],
    });
    expect(alerts.map((a) => a.key)).toEqual(["goal:1"]);
    expect(alerts[0].type).toBe("goal");
  });
});

describe("claimAlerts", () => {
  it("deux fois la même alerte → une seule", () => {
    const db = freshDb();
    const a = { key: "goal:1", type: "goal" as const, facts: {} };
    expect(claimAlerts(db, [a])).toHaveLength(1);
    expect(claimAlerts(db, [a])).toHaveLength(0);
    expect(db.select().from(alertLog).all()).toHaveLength(1);
  });
  it("réclame aussi les clés supplémentaires", () => {
    const db = freshDb();
    claimAlerts(db, [{ key: "b:100", type: "budget100" as const, facts: {}, extraKeys: ["b:80"] }]);
    expect(db.select().from(alertLog).all().map((r) => r.key).sort()).toEqual(["b:100", "b:80"]);
  });
});

describe("alertMessage", () => {
  const alerts = [
    {
      key: "k",
      type: "budget80" as const,
      facts: { category: "Alimentation", spent: "412,30 €", budget: "450,00 €", pct: "92 %" },
    },
  ];
  it("texte modèle sans IA", async () => {
    const text = await alertMessage(null, alerts);
    expect(text).toContain("**Alimentation**");
    expect(text).toContain("412,30 €");
  });
  it("texte modèle si l'IA échoue", async () => {
    const { ai } = fakeAi(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await alertMessage(ai, alerts)).toContain("**Alimentation**");
  });
  it("utilise Claude sans outils, max_tokens 600", async () => {
    const { ai, create } = fakeAi("Petit message");
    expect(await alertMessage(ai, alerts)).toBe("Petit message");
    const params = create.mock.calls[0][0] as Record<string, unknown>;
    expect(params.max_tokens).toBe(600);
    expect(params.tools).toBeUndefined();
  });
});

describe("runAlertChecks", () => {
  const sent: string[] = [];
  function listen() {
    sent.length = 0;
    cleanups.push(registerChannel("test-alerts", async (m) => void sent.push(m.content)));
  }
  const allMessages = (db: TestDb) => db.select().from(messages).all();

  it("budget dépassé après une dépense → un message d'alerte, relié au journal", async () => {
    const db = freshDb();
    listen();
    const cat = expenseCat(db, 10_000);
    const tx = createTransaction(db, {
      accountId: account(db).id,
      categoryId: cat.id,
      date: "2026-10-10",
      amount: -12_000,
      label: "Courses",
    });
    await runAlertChecks(db, { txIds: [tx.id] }, { ai: null, today: "2026-10-25" });
    const msgs = allMessages(db);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ kind: "alert", source: "system" });
    const log = db.select().from(alertLog).all();
    expect(log.some((r) => r.key === `budget:${cat.id}:2026-10:100` && r.messageId === msgs[0].id)).toBe(true);
    await runAlertChecks(db, { txIds: [tx.id] }, { ai: null, today: "2026-10-25" });
    expect(allMessages(db)).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it("alertes désactivées → rien", async () => {
    const db = freshDb();
    const cat = expenseCat(db, 10_000);
    setSetting(db, "alerts", { enabled: false });
    const tx = createTransaction(db, {
      accountId: account(db).id,
      categoryId: cat.id,
      date: "2026-10-10",
      amount: -12_000,
      label: "x",
    });
    await runAlertChecks(db, { txIds: [tx.id] }, { ai: null, today: "2026-10-25" });
    expect(allMessages(db)).toHaveLength(0);
    expect(db.select().from(alertLog).all()).toHaveLength(0);
  });

  it("règle désactivée → ignorée", async () => {
    const db = freshDb();
    const cat = expenseCat(db, 10_000);
    setSetting(db, "alerts", { budget: false });
    const tx = createTransaction(db, {
      accountId: account(db).id,
      categoryId: cat.id,
      date: "2026-10-10",
      amount: -12_000,
      label: "x",
    });
    await runAlertChecks(db, { txIds: [tx.id] }, { ai: null, today: "2026-10-25" });
    expect(allMessages(db)).toHaveLength(0);
  });

  it("dépense inhabituelle (médiane 90 j)", async () => {
    const db = freshDb();
    const cat = expenseCat(db, null);
    const accountId = account(db).id;
    insertTransactions(
      db,
      [1, 2, 3, 4, 5].map((i) => ({ accountId, categoryId: cat.id, date: `2026-09-0${i}`, amount: -2_000, label: "h" })),
    );
    const big = createTransaction(db, { accountId, categoryId: cat.id, date: "2026-10-10", amount: -20_000, label: "Gros" });
    const small = createTransaction(db, { accountId, categoryId: cat.id, date: "2026-10-11", amount: -5_000, label: "Petit" });
    await runAlertChecks(db, { txIds: [big.id, small.id] }, { ai: null, today: "2026-10-25" });
    expect(db.select().from(alertLog).all().map((r) => r.key)).toEqual([`expense:${big.id}`]);
  });

  it("import de 50 transactions déclenchant 30 alertes → 1 seul message", async () => {
    const db = freshDb();
    listen();
    const accountId = account(db).id;
    const cat = expenseCat(db, null);
    const ids = insertTransactions(
      db,
      Array.from({ length: 50 }, (_, i) => ({
        accountId,
        categoryId: cat.id,
        date: "2026-10-10",
        amount: i < 30 ? -50_000 : -100,
        label: `t${i}`,
      })),
    );
    expect(ids).toHaveLength(50);
    await runAlertChecks(db, { txIds: ids }, { ai: null, today: "2026-10-25" });
    expect(db.select().from(alertLog).all()).toHaveLength(30);
    expect(allMessages(db)).toHaveLength(1);
    expect(sent).toHaveLength(1);
    const content = allMessages(db)[0].content;
    expect(content.match(/^- /gm)).toHaveLength(10);
    expect(content).toContain("et 20 autres alertes");
  });

  it("objectif atteint (solde du compte lié)", async () => {
    const db = freshDb();
    const acc = account(db);
    db.insert(goals).values({ name: "Vacances", targetAmount: 100_000, currentAmount: 0, accountId: acc.id }).run();
    createTransaction(db, { accountId: acc.id, categoryId: null, date: "2026-10-01", amount: 2_000_000, label: "Salaire" });
    await runAlertChecks(db, { goals: true }, { ai: null, today: "2026-10-25" });
    expect(allMessages(db)).toHaveLength(1);
    expect(db.select().from(alertLog).all()[0].key).toMatch(/^goal:/);
  });

  it("variation de cours après actualisation, changePct stocké", async () => {
    const db = freshDb();
    const acc = account(db);
    db.insert(holdings)
      .values({ accountId: acc.id, symbol: "AAPL", name: "Apple", assetType: "stock", quantity: 2, avgPrice: 5_000 })
      .run();
    const stock: PriceFetcher = async () => new Map([["AAPL", { price: 200, currency: "EUR", changePct: 6.2 }]]);
    const none: PriceFetcher = async () => new Map();
    await refreshPrices(db, { stock, crypto: none, fx: async () => 1 }, new Date(), true);
    expect(db.select().from(prices).where(eq(prices.symbol, "AAPL")).get()!.changePct).toBe(6.2);
    await runAlertChecks(db, { prices: true }, { ai: null, today: "2026-10-25" });
    const log = db.select().from(alertLog).all();
    expect(log).toHaveLength(1);
    expect(log[0].key).toMatch(/^price:AAPL:\d{4}-\d{2}-\d{2}:up$/);
  });

  it("IA en erreur → texte modèle publié", async () => {
    const db = freshDb();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const cat = expenseCat(db, 10_000);
    const tx = createTransaction(db, {
      accountId: account(db).id,
      categoryId: cat.id,
      date: "2026-10-10",
      amount: -12_000,
      label: "x",
    });
    await runAlertChecks(db, { txIds: [tx.id] }, { ai: fakeAi(new Error("down")).ai, today: "2026-10-25" });
    expect(allMessages(db)[0].content).toContain("**");
  });

  it("historique importé : pas d'alerte budget sur les mois passés ni de dépense inhabituelle ancienne", async () => {
    const db = freshDb();
    const accountId = account(db).id;
    const cat = expenseCat(db, 10_000);
    const ids = insertTransactions(
      db,
      Array.from({ length: 12 }, (_, i) => ({
        accountId,
        categoryId: cat.id,
        date: `2025-${String(i + 1).padStart(2, "0")}-10`,
        amount: -50_000,
        label: `h${i}`,
      })),
    );
    await runAlertChecks(db, { txIds: ids }, { ai: null, today: "2026-10-25" });
    expect(db.select().from(alertLog).all()).toHaveLength(0);
    expect(allMessages(db)).toHaveLength(0);
  });

  it("modification d'une vieille transaction : rien", async () => {
    const db = freshDb();
    const cat = expenseCat(db, 10_000);
    const tx = createTransaction(db, { accountId: account(db).id, categoryId: cat.id, date: "2026-08-10", amount: -90_000, label: "old" });
    await runAlertChecks(db, { txIds: [tx.id] }, { ai: null, today: "2026-10-25" });
    expect(allMessages(db)).toHaveLength(0);
  });

  it("dépense de 35 jours incluse, 36 jours exclue", async () => {
    const db = freshDb();
    const cat = expenseCat(db, null);
    const accountId = account(db).id;
    const a = createTransaction(db, { accountId, categoryId: cat.id, date: "2026-09-20", amount: -50_000, label: "a" });
    const b = createTransaction(db, { accountId, categoryId: cat.id, date: "2026-09-19", amount: -50_000, label: "b" });
    await runAlertChecks(db, { txIds: [a.id, b.id] }, { ai: null, today: "2026-10-25" });
    expect(db.select().from(alertLog).all().map((r) => r.key)).toEqual([`expense:${a.id}`]);
  });

  it("échec de publication : clés libérées, le contrôle suivant renvoie l'alerte", async () => {
    const db = freshDb();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const cat = expenseCat(db, 10_000);
    const tx = createTransaction(db, { accountId: account(db).id, categoryId: cat.id, date: "2026-10-10", amount: -12_000, label: "x" });
    const spy = vi.spyOn(conversation, "postAssistantMessage").mockRejectedValueOnce(new Error("db down"));
    await runAlertChecks(db, { txIds: [tx.id] }, { ai: null, today: "2026-10-25" });
    expect(db.select().from(alertLog).all()).toHaveLength(0);
    expect(allMessages(db)).toHaveLength(0);
    spy.mockRestore();
    await runAlertChecks(db, { txIds: [tx.id] }, { ai: null, today: "2026-10-25" });
    expect(allMessages(db)).toHaveLength(1);
  });
});
