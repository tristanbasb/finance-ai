import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { seedDefaults } from "@/lib/db/seed";
import { accounts, holdings, jobRuns, messages } from "@/lib/db/schema";
import { digestPeriod, dueDigests, hourKey, isoWeek } from "@/lib/jobs/periods";
import { AI_REQUIRED_NOTICE, generateDigest } from "@/lib/jobs/digests";
import { claimJob, startScheduler, tick, type TickDeps } from "@/lib/jobs/scheduler";
import { DEFAULT_DIGEST_PREFS, getModelSetting, getSetting, setModelSetting, setSetting } from "@/lib/settings";
import Anthropic from "@anthropic-ai/sdk";
import type { Ai } from "@/lib/ai/client";
import type { PriceDeps } from "@/lib/prices";
import type { NewsDeps } from "@/lib/news";
import * as alerts from "@/lib/alerts/engine";
import { GET as getDigests, PUT as putDigests } from "@/app/api/settings/digests/route";
import { GET as getAlerts, PUT as putAlerts } from "@/app/api/settings/alerts/route";
import { z } from "zod";

const routeDb = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", async (orig) => ({ ...(await orig<typeof import("@/lib/db")>()), getDb: () => routeDb.db }));

function freshDb() {
  const db = createDb(":memory:");
  runMigrations(db);
  seedDefaults(db);
  return db;
}

const fakeAi = { client: {}, model: "m" } as unknown as Ai;
const prefs = DEFAULT_DIGEST_PREFS; // weekly + monthly, 8 h

// Lundi 26 octobre 2026.
const mon = (h: number, min = 0) => new Date(2026, 9, 26, h, min);

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(alerts, "runAlertChecks").mockResolvedValue(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  const g = globalThis as { __financeScheduler?: unknown };
  if (g.__financeScheduler) clearInterval(g.__financeScheduler as ReturnType<typeof setInterval>);
  g.__financeScheduler = undefined;
  vi.useRealTimers();
});

describe("isoWeek", () => {
  it("1er janvier", () => {
    expect(isoWeek(new Date(2026, 0, 1))).toBe("2026-W01"); // jeudi
    expect(isoWeek(new Date(2021, 0, 1))).toBe("2020-W53"); // vendredi
    expect(isoWeek(new Date(2024, 11, 30))).toBe("2025-W01"); // lundi
  });
  it("semaine 53", () => {
    expect(isoWeek(new Date(2020, 11, 31))).toBe("2020-W53");
    expect(isoWeek(new Date(2021, 0, 3))).toBe("2020-W53");
    expect(isoWeek(new Date(2021, 0, 4))).toBe("2021-W01");
  });
  it("semaine courante", () => expect(isoWeek(mon(9))).toBe("2026-W44"));
});

describe("dueDigests", () => {
  it("lundi avant / après 8 h", () => {
    expect(dueDigests(mon(7, 59), prefs, { monthly: "2026-10" })).toEqual([]);
    expect(dueDigests(mon(8), prefs, { monthly: "2026-10" })).toEqual(["weekly"]);
  });
  it("mardi : dû même avant l'heure (rattrapage)", () => {
    expect(dueDigests(new Date(2026, 9, 27, 3), prefs, { monthly: "2026-10" })).toEqual(["weekly"]);
  });
  it("déjà envoyé cette semaine", () => {
    expect(dueDigests(new Date(2026, 9, 28, 12), prefs, { weekly: "2026-W44", monthly: "2026-10" })).toEqual([]);
  });
  it("mensuel : 1er avant / après l'heure, puis le 2", () => {
    const w = { weekly: isoWeek(new Date(2026, 10, 1)) };
    expect(dueDigests(new Date(2026, 10, 1, 7), { ...prefs, weekly: false }, w)).toEqual([]);
    expect(dueDigests(new Date(2026, 10, 1, 8), { ...prefs, weekly: false }, w)).toEqual(["monthly"]);
    expect(dueDigests(new Date(2026, 10, 2, 1), { ...prefs, weekly: false }, w)).toEqual(["monthly"]);
    expect(dueDigests(new Date(2026, 10, 2, 9), { ...prefs, weekly: false }, { monthly: "2026-11" })).toEqual([]);
  });
  it("préférences désactivées", () => {
    expect(dueDigests(mon(9), { ...prefs, weekly: false, monthly: false }, {})).toEqual([]);
  });
});

describe("digestPeriod", () => {
  it("semaine à cheval sur deux années : année sur la première date", () => {
    expect(digestPeriod("weekly", new Date(2026, 0, 5, 9)).title).toBe(
      "Bilan de la semaine du 29 décembre 2025 au 4 janvier 2026",
    );
  });
  it("semaine précédente et mois précédent", () => {
    expect(digestPeriod("weekly", mon(9))).toEqual({
      start: "2026-10-19",
      end: "2026-10-25",
      title: "Bilan de la semaine du 19 au 25 octobre",
    });
    expect(digestPeriod("weekly", new Date(2026, 10, 3, 9)).title).toBe(
      "Bilan de la semaine du 26 octobre au 1er novembre",
    );
    expect(digestPeriod("monthly", new Date(2026, 10, 2, 9))).toEqual({
      start: "2026-10-01",
      end: "2026-10-31",
      title: "Bilan d'octobre 2026",
    });
    const title = (m: number) => digestPeriod("monthly", new Date(2026, m, 3, 9)).title;
    expect(title(4)).toBe("Bilan d'avril 2026");
    expect(title(8)).toBe("Bilan d'août 2026");
    expect(title(3)).toBe("Bilan de mars 2026");
    expect(title(1)).toBe("Bilan de janvier 2026");
    expect(title(11)).toBe("Bilan de novembre 2026");
    expect(digestPeriod("monthly", new Date(2027, 0, 5)).start).toBe("2026-12-01");
  });
});

describe("claimJob", () => {
  it("un seul gagnant par période", () => {
    const db = freshDb();
    expect(claimJob(db, "weekly", "2026-W44")).toBe(true);
    expect(claimJob(db, "weekly", "2026-W44")).toBe(false);
    expect(claimJob(db, "weekly", "2026-W45")).toBe(true);
    expect(db.select().from(jobRuns).where(eq(jobRuns.job, "weekly")).get()?.lastPeriod).toBe("2026-W45");
  });
});

/** Bilans déjà passés (semaine 43, septembre) : le premier démarrage est derrière nous. */
function pastRuns(db: ReturnType<typeof freshDb>) {
  claimJob(db, "weekly", "2026-W43");
  claimJob(db, "monthly", "2026-09");
  return db;
}

function digestMessages(db: ReturnType<typeof freshDb>) {
  return db.select().from(messages).all().filter((m) => m.kind === "weekly" || m.kind === "monthly");
}

describe("tick : bilans", () => {
  it("génère le bilan hebdo une seule fois sur deux ticks", async () => {
    const db = pastRuns(freshDb());
    setSetting(db, "digests", { ...prefs, monthly: false });
    const generate = vi.fn(async () => "**Bilan**\n\ncorps");
    const deps: TickDeps = { ai: fakeAi, generate };
    await tick(db, mon(8, 1), deps);
    await tick(db, mon(8, 2), deps);
    expect(generate).toHaveBeenCalledTimes(1);
    const rows = digestMessages(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "weekly", role: "assistant", content: "**Bilan**\n\ncorps" });
  });

  it("rattrapage (mardi, serveur éteint lundi)", async () => {
    const db = pastRuns(freshDb());
    setSetting(db, "digests", { ...prefs, monthly: false });
    const generate = vi.fn(async () => "x");
    await tick(db, new Date(2026, 9, 27, 14), { ai: fakeAi, generate });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(digestMessages(db)).toHaveLength(1);
  });

  it("échec de génération : réclamation libérée, nouvel essai au tick suivant", async () => {
    const db = pastRuns(freshDb());
    setSetting(db, "digests", { ...prefs, monthly: false });
    const generate = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue("ok");
    await tick(db, mon(9), { ai: fakeAi, generate });
    expect(digestMessages(db)).toHaveLength(0);
    expect(db.select().from(jobRuns).where(eq(jobRuns.job, "weekly")).get()?.lastPeriod).toBe("2026-W43");
    await tick(db, mon(9, 15), { ai: fakeAi, generate });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(digestMessages(db)).toHaveLength(1);
  });

  it("IA absente : un seul avis en tout, pas un par type", async () => {
    const db = pastRuns(freshDb());
    await tick(db, mon(9), { ai: null });
    await tick(db, mon(9, 1), { ai: null });
    // semaine suivante : toujours pas de nouveau message
    await tick(db, new Date(2026, 10, 2, 9), { ai: null });
    const rows = digestMessages(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe(AI_REQUIRED_NOTICE);
    expect(getSetting(db, "digest_ai_notice", z.boolean(), false)).toBe(true);
  });

  it("premier démarrage : aucun bilan, périodes courantes réclamées ; période suivante : bilans", async () => {
    const db = freshDb();
    const generate = vi.fn(async () => "x");
    await tick(db, mon(9), { ai: fakeAi, generate });
    expect(generate).not.toHaveBeenCalled();
    expect(digestMessages(db)).toHaveLength(0);
    expect(db.select().from(jobRuns).where(eq(jobRuns.job, "weekly")).get()?.lastPeriod).toBe("2026-W44");
    expect(db.select().from(jobRuns).where(eq(jobRuns.job, "monthly")).get()?.lastPeriod).toBe("2026-10");
    await tick(db, mon(10), { ai: fakeAi, generate });
    expect(generate).not.toHaveBeenCalled();
    // lundi 2 novembre : nouvelle semaine et nouveau mois
    await tick(db, new Date(2026, 10, 2, 9), { ai: fakeAi, generate });
    expect(generate.mock.calls.map((c) => (c as unknown[])[2]).sort()).toEqual(["monthly", "weekly"]);
    expect(digestMessages(db)).toHaveLength(2);
  });

  it("premier démarrage sans IA : pas d'avis tout de suite", async () => {
    const db = freshDb();
    await tick(db, mon(9), { ai: null });
    expect(digestMessages(db)).toHaveLength(0);
  });

  it("ne lève jamais", async () => {
    const db = pastRuns(freshDb());
    const generate = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(tick(db, mon(9), { ai: fakeAi, generate })).resolves.toBeUndefined();
  });
});

describe("tick : cours horaires", () => {
  function withHolding(db: ReturnType<typeof freshDb>) {
    const acc = db.select().from(accounts).get()!;
    db.insert(holdings)
      .values({ accountId: acc.id, symbol: "AAPL", name: "Apple", assetType: "stock", quantity: 1, avgPrice: 100 })
      .run();
  }
  const stock = vi.fn(async () => new Map([["AAPL", { price: 150, currency: "EUR" }]]));
  const priceDeps = (): PriceDeps => ({ stock, crypto: async () => new Map(), fx: async () => 1 });

  it("une fois par heure, seulement avec des positions", async () => {
    const db = freshDb();
    setSetting(db, "digests", { ...prefs, weekly: false, monthly: false });
    stock.mockClear();
    await tick(db, mon(9, 0), { ai: null, prices: priceDeps(), news: newsDeps() });
    expect(stock).not.toHaveBeenCalled(); // pas de position
    withHolding(db);
    await tick(db, mon(9, 5), { ai: null, prices: priceDeps(), news: newsDeps() });
    await tick(db, mon(9, 40), { ai: null, prices: priceDeps(), news: newsDeps() });
    expect(stock).toHaveBeenCalledTimes(1);
    expect(alerts.runAlertChecks).toHaveBeenCalledWith(db, { prices: true, goals: true });
    await tick(db, mon(10, 1), { ai: null, prices: priceDeps(), news: newsDeps() });
    expect(stock).toHaveBeenCalledTimes(2);
    expect(hourKey(mon(10, 1))).toBe("2026-10-26T10");
  });

  const newsDeps = (fetch = vi.fn(async () => [])): NewsDeps & { fetch: ReturnType<typeof vi.fn> } => ({
    fetch,
    ai: () => null,
  });

  it("actualités : pas à 23 h, oui à 10 h", async () => {
    const db = freshDb();
    setSetting(db, "digests", { ...prefs, weekly: false, monthly: false });
    withHolding(db);
    const news = newsDeps();
    await tick(db, mon(23), { ai: null, prices: priceDeps(), news });
    expect(news.fetch).not.toHaveBeenCalled();
    await tick(db, mon(10), { ai: null, prices: priceDeps(), news });
    expect(news.fetch).toHaveBeenCalledWith("AAPL");
  });

  it("actualités : un fetcher qui lève n'empêche pas les contrôles d'alertes", async () => {
    const db = freshDb();
    setSetting(db, "digests", { ...prefs, weekly: false, monthly: false });
    withHolding(db);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const news = newsDeps(vi.fn(async () => { throw new Error("réseau"); }));
    await tick(db, mon(10), { ai: null, prices: priceDeps(), news });
    expect(alerts.runAlertChecks).toHaveBeenCalledWith(db, { prices: true, goals: true });
  });

  it("une erreur de cours ne bloque pas les bilans", async () => {
    const db = pastRuns(freshDb());
    withHolding(db);
    const generate = vi.fn(async () => "x");
    const prices: PriceDeps = { stock: async () => { throw new Error("réseau"); }, crypto: async () => new Map(), fx: async () => 1 };
    await tick(db, mon(9), { ai: fakeAi, generate, prices, news: newsDeps() });
    expect(generate).toHaveBeenCalled();
  });
});

describe("startScheduler", () => {
  it("tick immédiat, garde globalThis, arrêt", async () => {
    vi.useFakeTimers();
    const db = pastRuns(freshDb());
    setSetting(db, "digests", { ...prefs, monthly: false });
    const generate = vi.fn(async () => "x");
    const stop = startScheduler(db, { intervalMs: 1000, now: () => mon(9), deps: { ai: fakeAi, generate } });
    const again = startScheduler(db, { now: () => mon(9), deps: { ai: fakeAi, generate } });
    await vi.advanceTimersByTimeAsync(3000);
    expect(generate).toHaveBeenCalledTimes(1);
    again();
    stop();
    expect((globalThis as { __financeScheduler?: unknown }).__financeScheduler).toBeUndefined();
  });
});

describe("generateDigest", () => {
  it("préfixe le titre et concatène le texte", async () => {
    const db = freshDb();
    const events = [{ type: "text", text: "Bon" }, { type: "tool", name: "x" }, { type: "text", text: "jour" + "x".repeat(200) }, { type: "done" }];
    const chat = await import("@/lib/ai/chat");
    vi.spyOn(chat, "runChat").mockImplementation((async function* () {
      for (const e of events) yield e;
    }) as unknown as typeof chat.runChat);
    const out = await generateDigest(db, fakeAi, "weekly", mon(9));
    expect(out).toBe("**Bilan de la semaine du 19 au 25 octobre**\n\nBonjour" + "x".repeat(200));
  });
});

describe("generateDigest : texte inutilisable", () => {
  async function gen(text: string) {
    const chat = await import("@/lib/ai/chat");
    vi.spyOn(chat, "runChat").mockImplementation((async function* () {
      yield { type: "text", text };
    }) as unknown as typeof chat.runChat);
    return generateDigest(freshDb(), fakeAi, "weekly", mon(9));
  }
  it("trop court → erreur", async () => {
    await expect(gen("Bonjour")).rejects.toThrow();
  });
  it("texte de refus → erreur", async () => {
    await expect(gen("Je ne peux pas répondre à cette demande.")).rejects.toThrow();
  });
  it("200 caractères → accepté", async () => {
    await expect(gen("a".repeat(200))).resolves.toContain("a".repeat(200));
  });
});

describe("tick : politique de reprise", () => {
  it("échec de publication : réclamation libérée", async () => {
    const db = pastRuns(freshDb());
    setSetting(db, "digests", { ...prefs, monthly: false });
    const conv = await import("@/lib/assistant/conversation");
    vi.spyOn(conv, "postAssistantMessage").mockRejectedValueOnce(new Error("dispatch"));
    const generate = vi.fn(async () => "x");
    await tick(db, mon(9), { ai: fakeAi, generate });
    expect(db.select().from(jobRuns).where(eq(jobRuns.job, "weekly")).get()?.lastPeriod).toBe("2026-W43");
  });

  it("3 essais max, espacés de 15 min, puis abandon", async () => {
    const db = pastRuns(freshDb());
    setSetting(db, "digests", { ...prefs, monthly: false });
    const generate = vi.fn().mockRejectedValue(new Error("boom"));
    const run = (min: number) => tick(db, mon(9, min), { ai: fakeAi, generate });
    await run(0);
    await run(10); // trop tôt
    expect(generate).toHaveBeenCalledTimes(1);
    await run(15);
    await run(20); // trop tôt
    expect(generate).toHaveBeenCalledTimes(2);
    await run(30); // 3e essai
    expect(generate).toHaveBeenCalledTimes(3);
    // abandon : réclamation conservée, plus aucun essai
    expect(db.select().from(jobRuns).where(eq(jobRuns.job, "weekly")).get()?.lastPeriod).toBe("2026-W44");
    await run(50);
    await run(59);
    expect(generate).toHaveBeenCalledTimes(3);
    expect(digestMessages(db)).toHaveLength(0);
  });

  it("modèle retiré : réglage effacé, nouvel essai avec le modèle par défaut", async () => {
    const db = pastRuns(freshDb());
    setSetting(db, "digests", { ...prefs, monthly: false });
    setModelSetting(db, "claude-retired-1");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const notFound = Anthropic.APIError.generate(
      404,
      { type: "error", error: { type: "not_found_error", message: "model: claude-retired-1" } },
      "m",
      new Headers(),
    );
    const generate = vi.fn().mockRejectedValueOnce(notFound).mockResolvedValue("x");
    await tick(db, mon(9), { ai: fakeAi, generate });
    expect(getModelSetting(db)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(digestMessages(db)).toHaveLength(0);
    await tick(db, mon(9, 15), { ai: fakeAi, generate });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(digestMessages(db)).toHaveLength(1);
  });

  it("nouvelle période : compteur remis à zéro", async () => {
    const db = pastRuns(freshDb());
    setSetting(db, "digests", { ...prefs, monthly: false });
    const generate = vi.fn().mockRejectedValue(new Error("boom"));
    for (const m of [0, 15, 30]) await tick(db, mon(9, m), { ai: fakeAi, generate });
    await tick(db, new Date(2026, 10, 2, 9), { ai: fakeAi, generate });
    expect(generate).toHaveBeenCalledTimes(4);
  });
});

describe("tick : drapeau d'exécution", () => {
  afterEach(() => {
    (globalThis as { __financeTickRunning?: number }).__financeTickRunning = undefined;
  });
  it("drapeau récent : tick ignoré ; plus vieux que 10 min : ignoré", async () => {
    const db = pastRuns(freshDb());
    setSetting(db, "digests", { ...prefs, monthly: false });
    const generate = vi.fn(async () => "x");
    const g = globalThis as { __financeTickRunning?: number };
    g.__financeTickRunning = mon(9).getTime() - 60_000;
    await tick(db, mon(9), { ai: fakeAi, generate });
    expect(generate).not.toHaveBeenCalled();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    g.__financeTickRunning = mon(9).getTime() - 11 * 60_000;
    await tick(db, mon(9), { ai: fakeAi, generate });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalled();
    expect(g.__financeTickRunning).toBeUndefined();
  });
});

describe("routes de réglages", () => {
  const put = (fn: typeof putDigests, body: unknown) =>
    fn(new Request("http://x/api", { method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

  beforeEach(() => {
    routeDb.db = freshDb();
  });

  it("digests : défauts, fusion partielle, validation", async () => {
    expect(await (await getDigests()).json()).toEqual(DEFAULT_DIGEST_PREFS);
    const res = await put(putDigests, { hour: 18 });
    expect(await res.json()).toEqual({ weekly: true, monthly: true, hour: 18 });
    expect(await (await getDigests()).json()).toMatchObject({ hour: 18 });
    expect((await put(putDigests, { hour: 30 })).status).toBe(400);
  });

  it("digests : PUT partiel conserve les réglages désactivés", async () => {
    await put(putDigests, { weekly: false });
    const res = await put(putDigests, { hour: 18 });
    expect(await res.json()).toEqual({ weekly: false, monthly: true, hour: 18 });
  });

  it("alertes : PUT partiel conserve les réglages désactivés", async () => {
    await put(putAlerts, { enabled: false });
    const res = await put(putAlerts, { unusualMinEur: 50 });
    expect(await res.json()).toMatchObject({ enabled: false, unusualMinEur: 50, budget: true });
    expect((await put(putAlerts, { unusualMinEur: "x" })).status).toBe(400);
    expect((await put(putAlerts, { unusualMinEur: 0 })).status).toBe(400);
  });

  it("alertes : défauts, fusion partielle, validation", async () => {
    expect(await (await getAlerts()).json()).toMatchObject({ enabled: true, priceMovePct: 5 });
    const res = await put(putAlerts, { enabled: false, priceMovePct: 8 });
    expect(await res.json()).toMatchObject({ enabled: false, priceMovePct: 8, budget: true });
    expect((await put(putAlerts, { priceMovePct: -1 })).status).toBe(400);
  });
});
