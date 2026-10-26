import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { seedDefaults } from "@/lib/db/seed";
import { accounts, alertLog, categories, goals, holdings, messages, news, newsSymbols, prices } from "@/lib/db/schema";
import { budgetAlerts, goalReachedAlerts, priceMoveAlerts, unusualExpense } from "@/lib/alerts/rules";
import Anthropic from "@anthropic-ai/sdk";
import {
  ALERT_MESSAGE_TIMEOUT_MS,
  ALERTS_BASELINE_KEY,
  alertMessage,
  baselineAlerts,
  claimAlerts,
  runAlertChecks,
} from "@/lib/alerts/engine";
import { createTransaction, insertTransactions } from "@/lib/queries/transactions";
import { refreshPrices, type PriceFetcher } from "@/lib/prices";
import { registerChannel } from "@/lib/assistant/dispatch";
import { getModelSetting, getSetting, setModelSetting, setSetting } from "@/lib/settings";
import { z } from "zod";
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
  const create = vi.fn(async (params: unknown, opts?: unknown) => {
    void params;
    void opts;
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

  it("date de la séance propre à la variation, sinon date du jour", () => {
    const [a] = priceMoveAlerts({ moves: [{ ...move(6), date: "2026-10-23" }], thresholdPct: 5, date: "2026-10-25" });
    expect(a.key).toBe("price:AAPL:2026-10-23:up");
  });
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
    const opts = create.mock.calls[0][1] as { signal?: AbortSignal } | undefined;
    expect(opts?.signal).toBeInstanceOf(AbortSignal);
  });
  it("délai dépassé (60 s par défaut) → texte modèle", async () => {
    expect(ALERT_MESSAGE_TIMEOUT_MS).toBe(60_000);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const create = vi.fn(
      (_params: unknown, opts?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => opts?.signal?.addEventListener("abort", () => reject(opts.signal!.reason))),
    );
    const ai = { client: { messages: { create } }, model: "claude-opus-5-5" } as unknown as Ai;
    expect(await alertMessage(ai, alerts, { timeoutMs: 20 })).toContain("**Alimentation**");
  });
  it("modèle retiré → réglage du modèle effacé, texte modèle", async () => {
    const db = freshDb();
    setModelSetting(db, "claude-retired-1");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const notFound = Anthropic.APIError.generate(
      404,
      { type: "error", error: { type: "not_found_error", message: "model: claude-retired-1" } },
      "m",
      new Headers(),
    );
    const { ai } = fakeAi(notFound);
    expect(await alertMessage(ai, alerts, { db })).toContain("**Alimentation**");
    expect(getModelSetting(db)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
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

  it("modification (expenseRule: false) : pas de dépense inhabituelle, budget toujours contrôlé", async () => {
    const db = freshDb();
    const cat = expenseCat(db, 10_000);
    const tx = createTransaction(db, { accountId: account(db).id, categoryId: cat.id, date: "2026-10-10", amount: -50_000, label: "Gros" });
    await runAlertChecks(db, { txIds: [tx.id], goals: true, expenseRule: false }, { ai: null, today: "2026-10-25" });
    expect(db.select().from(alertLog).all().map((r) => r.key)).toEqual([`budget:${cat.id}:2026-10:100`, `budget:${cat.id}:2026-10:80`]);
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

  it("référence initiale : objectif déjà atteint → pas d'alerte ; objectif atteint ensuite → alerte", async () => {
    const db = freshDb();
    const acc = account(db);
    const old = db.insert(goals).values({ name: "Ancien", targetAmount: 100_000, currentAmount: 150_000 }).returning().get();
    db.insert(goals).values({ name: "Vacances", targetAmount: 100_000, currentAmount: 0, accountId: acc.id }).run();
    baselineAlerts(db, "2026-10-25");
    expect(getSetting(db, ALERTS_BASELINE_KEY, z.boolean(), false)).toBe(true);
    expect(db.select().from(alertLog).all().map((r) => r.key)).toEqual([`goal:${old.id}`]);
    await runAlertChecks(db, { goals: true }, { ai: null, today: "2026-10-25" });
    expect(allMessages(db)).toHaveLength(0);
    createTransaction(db, { accountId: acc.id, categoryId: null, date: "2026-10-26", amount: 2_000_000, label: "Salaire" });
    baselineAlerts(db, "2026-10-26"); // déjà faite : sans effet
    await runAlertChecks(db, { goals: true }, { ai: null, today: "2026-10-26" });
    expect(allMessages(db)).toHaveLength(1);
    expect(allMessages(db)[0].content).toContain("Vacances");
    expect(allMessages(db)[0].content).not.toContain("Ancien");
  });

  it("variation de cours après actualisation, changePct stocké", async () => {
    const db = freshDb();
    const acc = account(db);
    db.insert(holdings)
      .values({ accountId: acc.id, symbol: "AAPL", name: "Apple", assetType: "stock", quantity: 2, avgPrice: 5_000 })
      .run();
    const now = new Date(2026, 9, 26, 15);
    const stock: PriceFetcher = async () =>
      new Map([["AAPL", { price: 200, currency: "EUR", changePct: 6.2, changeAt: now.getTime() - 60_000 }]]);
    const none: PriceFetcher = async () => new Map();
    await refreshPrices(db, { stock, crypto: none, fx: async () => 1 }, now, true);
    expect(db.select().from(prices).where(eq(prices.symbol, "AAPL")).get()!.changePct).toBe(6.2);
    await runAlertChecks(db, { prices: true }, { ai: null, now: now.getTime() });
    const log = db.select().from(alertLog).all();
    expect(log).toHaveLength(1);
    expect(log[0].key).toBe("price:AAPL:2026-10-26:up");
  });

  describe("actualités jointes aux variations de cours", () => {
    const now = new Date(2026, 9, 26, 15).getTime();
    function setup(db: TestDb) {
      db.insert(holdings)
        .values({ accountId: account(db).id, symbol: "aapl", name: "Apple", assetType: "stock", quantity: 2, avgPrice: 5_000 })
        .run();
      db.insert(prices)
        .values({ symbol: "aapl", price: 200, currency: "EUR", fetchedAt: now - 60_000, changePct: 6, changeAt: now - 60_000 })
        .run();
    }
    function article(db: TestDb, uuid: string, title: string, titleFr: string | null, publishedAt: number) {
      const row = db
        .insert(news)
        .values({ uuid, title, titleFr, publisher: "Yahoo", link: `https://x/${uuid}`, publishedAt, fetchedAt: now })
        .returning({ id: news.id })
        .get();
      db.insert(newsSymbols).values({ newsId: row.id, symbol: "AAPL" }).run();
    }

    it("article de 10 h : titre fr dans facts.news, texte modèle « Actualité : »", async () => {
      const db = freshDb();
      setup(db);
      article(db, "a", "Apple beats", "Apple dépasse les attentes", now - 10 * 3_600_000);
      article(db, "b", "Old news", "Vieille nouvelle", now - 3 * 86_400_000);
      const { ai, create } = fakeAi("Message");
      await runAlertChecks(db, { prices: true }, { ai, now });
      const sentPrompt = JSON.stringify(create.mock.calls[0][0]);
      expect(sentPrompt).toContain("Apple dépasse les attentes");
      expect(sentPrompt).not.toContain("Vieille nouvelle");

      const db2 = freshDb();
      setup(db2);
      article(db2, "a", "Apple beats", "Apple dépasse les attentes", now - 10 * 3_600_000);
      await runAlertChecks(db2, { prices: true }, { ai: null, now });
      expect(db2.select().from(messages).all()[0].content).toContain("Actualité : Apple dépasse les attentes.");
    });

    it("titre d'origine sans traduction, 3 titres au plus joints par « ; »", async () => {
      const db = freshDb();
      setup(db);
      for (let i = 1; i <= 4; i++) article(db, `u${i}`, `Title ${i}`, null, now - i * 3_600_000);
      await runAlertChecks(db, { prices: true }, { ai: null, now });
      expect(db.select().from(messages).all()[0].content).toContain("Actualité : Title 1 ; Title 2 ; Title 3.");
    });

    it("article de 3 jours seulement : pas de clé news", async () => {
      const db = freshDb();
      setup(db);
      article(db, "b", "Old news", "Vieille nouvelle", now - 3 * 86_400_000);
      const { ai, create } = fakeAi("Message");
      await runAlertChecks(db, { prices: true }, { ai, now });
      const sentPrompt = JSON.stringify(create.mock.calls[0][0]);
      expect(sentPrompt).not.toContain('\\"news\\"');
      const db2 = freshDb();
      setup(db2);
      article(db2, "b", "Old news", "Vieille nouvelle", now - 3 * 86_400_000);
      await runAlertChecks(db2, { prices: true }, { ai: null, now });
      const text = db2.select().from(messages).all()[0].content;
      expect(text).toContain("Apple");
      expect(text).not.toContain("Actualité");
    });
  });

  describe("marché fermé (week-end, avant l'ouverture)", () => {
    function setupHoldings(db: TestDb) {
      const acc = account(db);
      db.insert(holdings)
        .values([
          { accountId: acc.id, symbol: "AAPL", name: "Apple", assetType: "stock", quantity: 2, avgPrice: 5_000 },
          { accountId: acc.id, symbol: "BTC", name: "Bitcoin", assetType: "crypto", quantity: 1, avgPrice: 5_000 },
        ])
        .run();
    }
    async function refreshAt(db: TestDb, now: Date, stock: { changePct: number; changeAt?: number } | null, crypto?: number) {
      const s: PriceFetcher = async () => new Map(stock ? [["AAPL", { price: 200, currency: "EUR", ...stock }]] : []);
      const c: PriceFetcher = async () =>
        new Map(crypto === undefined ? [] : [["BTC", { price: 50_000, currency: "EUR", changePct: crypto }]]);
      await refreshPrices(db, { stock: s, crypto: c, fx: async () => 1 }, now, true);
      await runAlertChecks(db, { prices: true }, { ai: null, now: now.getTime() });
    }
    const priceKeys = (db: TestDb) =>
      db
        .select()
        .from(alertLog)
        .all()
        .map((r) => r.key)
        .filter((k) => k.startsWith("price:AAPL"))
        .sort();

    it("variation du vendredi revue samedi, dimanche et lundi avant l'ouverture → une seule alerte", async () => {
      const db = freshDb();
      setupHoldings(db);
      const friday = new Date(2026, 9, 23, 17, 35).getTime();
      await refreshAt(db, new Date(2026, 9, 23, 18), { changePct: 6.2, changeAt: friday });
      await refreshAt(db, new Date(2026, 9, 24, 10), { changePct: 6.2, changeAt: friday });
      await refreshAt(db, new Date(2026, 9, 25, 10), { changePct: 6.2, changeAt: friday });
      await refreshAt(db, new Date(2026, 9, 26, 8), { changePct: 6.2, changeAt: friday });
      expect(priceKeys(db)).toEqual(["price:AAPL:2026-10-23:up"]);
      expect(allMessages(db)).toHaveLength(1);
      // Nouvelle séance du lundi : nouvelle variation → nouvelle alerte.
      await refreshAt(db, new Date(2026, 9, 26, 16), { changePct: 7, changeAt: new Date(2026, 9, 26, 15, 55).getTime() });
      expect(priceKeys(db)).toEqual(["price:AAPL:2026-10-23:up", "price:AAPL:2026-10-26:up"]);
      expect(allMessages(db)).toHaveLength(2);
    });

    it("séance de plus de 3 jours ou heure inconnue → pas d'alerte action ; crypto : date du jour", async () => {
      const db = freshDb();
      setupHoldings(db);
      const old = new Date(2026, 9, 22, 17, 35).getTime(); // jeudi, 4 jours avant
      await refreshAt(db, new Date(2026, 9, 26, 8), { changePct: 9, changeAt: old }, 8);
      await refreshAt(db, new Date(2026, 9, 26, 9), { changePct: 9 }, 8);
      expect(priceKeys(db)).toEqual([]);
      expect(db.select().from(alertLog).all().map((r) => r.key)).toEqual(["price:BTC:2026-10-26:up"]);
    });
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
