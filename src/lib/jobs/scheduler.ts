import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getAi, type Ai } from "@/lib/ai/client";
import { runAlertChecks } from "@/lib/alerts/engine";
import { postAssistantMessage } from "@/lib/assistant/conversation";
import type { Db } from "@/lib/db";
import { holdings, jobRuns } from "@/lib/db/schema";
import { todayLocal } from "@/lib/dates";
import { refreshPrices, type PriceDeps } from "@/lib/prices";
import { realPriceDeps } from "@/lib/prices/real-deps";
import { recordSnapshot } from "@/lib/queries/snapshots";
import { digestPrefs, getSetting, setSetting } from "@/lib/settings";
import { AI_REQUIRED_NOTICE, generateDigest } from "./digests";
import { dueDigests, hourKey, isoWeek, monthKey, type DigestKind } from "./periods";

export type TickDeps = {
  /** Client IA ; `undefined` → `getAi(db)`, `null` → IA absente. */
  ai?: Ai | null;
  generate?: typeof generateDigest;
  prices?: PriceDeps;
};

/** Réclame atomiquement (job, période) : vrai si cette période n'était pas déjà réclamée. */
export function claimJob(db: Db, job: string, period: string, now: number = Date.now()): boolean {
  const res = db.run(sql`
    INSERT INTO job_runs (job, last_period, last_run_at) VALUES (${job}, ${period}, ${now})
    ON CONFLICT(job) DO UPDATE SET last_period = excluded.last_period, last_run_at = excluded.last_run_at
    WHERE job_runs.last_period IS NOT excluded.last_period`);
  return res.changes > 0;
}

export function lastPeriod(db: Db, job: string): string | undefined {
  return db.select().from(jobRuns).where(eq(jobRuns.job, job)).get()?.lastPeriod;
}

/** Annule une réclamation : restaure la période précédente (ou supprime la ligne). */
function releaseJob(db: Db, job: string, previous: string | undefined): void {
  if (previous === undefined) db.delete(jobRuns).where(eq(jobRuns.job, job)).run();
  else db.update(jobRuns).set({ lastPeriod: previous }).where(eq(jobRuns.job, job)).run();
}

async function runDigest(db: Db, kind: DigestKind, now: Date, deps: TickDeps): Promise<void> {
  const period = kind === "weekly" ? isoWeek(now) : monthKey(now);
  const previous = lastPeriod(db, kind);
  if (!claimJob(db, kind, period, now.getTime())) return;
  const ai = deps.ai === undefined ? getAi(db) : deps.ai;
  if (!ai) {
    const noticeKey = `digest_ai_notice_${kind}`;
    if (!getSetting(db, noticeKey, z.boolean(), false)) {
      setSetting(db, noticeKey, true);
      await postAssistantMessage(db, { kind, content: AI_REQUIRED_NOTICE });
    }
    return;
  }
  let content: string;
  try {
    content = await (deps.generate ?? generateDigest)(db, ai, kind, now);
  } catch (err) {
    releaseJob(db, kind, previous);
    console.error(`[jobs] bilan ${kind} échoué (nouvel essai au prochain passage) :`, err);
    return;
  }
  await postAssistantMessage(db, { kind, content, meta: { period } });
}

async function runPrices(db: Db, now: Date, deps: TickDeps): Promise<void> {
  const any = db
    .select({ id: holdings.id })
    .from(holdings)
    .where(inArray(holdings.assetType, ["stock", "etf", "crypto"]))
    .limit(1)
    .get();
  if (!any) return;
  if (!claimJob(db, "prices", hourKey(now), now.getTime())) return;
  await refreshPrices(db, deps.prices ?? realPriceDeps(), now, false);
  recordSnapshot(db, todayLocal(now));
  await runAlertChecks(db, { prices: true, goals: true });
}

/** Un passage du planificateur : bilans dus puis cours horaires. Ne lève jamais. */
export async function tick(db: Db, now: Date, deps: TickDeps = {}): Promise<void> {
  const g = globalThis as { __financeTickRunning?: boolean };
  if (g.__financeTickRunning) return;
  g.__financeTickRunning = true;
  try {
    try {
      const due = dueDigests(now, digestPrefs(db), {
        weekly: lastPeriod(db, "weekly"),
        monthly: lastPeriod(db, "monthly"),
      });
      for (const kind of due) {
        try {
          await runDigest(db, kind, now, deps);
        } catch (err) {
          console.error(`[jobs] bilan ${kind} :`, err);
        }
      }
    } catch (err) {
      console.error("[jobs] bilans :", err);
    }
    try {
      await runPrices(db, now, deps);
    } catch (err) {
      console.error("[jobs] cours :", err);
    }
  } finally {
    g.__financeTickRunning = false;
  }
}

/**
 * Démarre le planificateur (un seul par processus, garde `globalThis.__financeScheduler`) :
 * passage immédiat (rattrapage) puis à intervalle régulier. Renvoie une fonction d'arrêt.
 */
export function startScheduler(
  db: Db,
  {
    intervalMs = 60_000,
    now = () => new Date(),
    deps,
  }: { intervalMs?: number; now?: () => Date; deps?: TickDeps } = {},
): () => void {
  const g = globalThis as { __financeScheduler?: ReturnType<typeof setInterval> };
  if (g.__financeScheduler) return () => {};
  const run = () => void tick(db, now(), deps);
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  g.__financeScheduler = timer;
  return () => {
    clearInterval(timer);
    if (g.__financeScheduler === timer) g.__financeScheduler = undefined;
  };
}
