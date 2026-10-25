import { afterEach, describe, expect, it, vi } from "vitest";
import { createDb } from "@/lib/db";

const state = vi.hoisted(() => ({ db: null as unknown, order: [] as string[] }));
vi.mock("@/lib/db", async (orig) => ({ ...(await orig<typeof import("@/lib/db")>()), getDb: () => state.db }));
vi.mock("@/lib/alerts/engine", async (orig) => {
  const real = await orig<typeof import("@/lib/alerts/engine")>();
  return {
    ...real,
    baselineAlerts: vi.fn((...args: Parameters<typeof real.baselineAlerts>) => {
      state.order.push("baseline");
      return real.baselineAlerts(...args);
    }),
  };
});
vi.mock("@/lib/jobs/scheduler", () => ({ startScheduler: vi.fn(() => state.order.push("scheduler")) }));
vi.mock("@/lib/telegram/bot", () => ({ startBot: vi.fn(() => state.order.push("bot")) }));

import { register } from "@/instrumentation";

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

describe("instrumentation", () => {
  it("référence initiale des alertes avant le planificateur", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    delete process.env.NEXT_PHASE;
    delete process.env.FINANCE_AI_DISABLE_JOBS;
    state.db = createDb(":memory:");
    state.order.length = 0;
    await register();
    expect(state.order).toEqual(["baseline", "scheduler", "bot"]);
  });

  it("échec de la référence initiale : journalisé, planificateur et bot démarrés quand même", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    delete process.env.NEXT_PHASE;
    delete process.env.FINANCE_AI_DISABLE_JOBS;
    state.db = createDb(":memory:");
    state.order.length = 0;
    const engine = await import("@/lib/alerts/engine");
    vi.mocked(engine.baselineAlerts).mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await register();
    expect(state.order).toEqual(["scheduler", "bot"]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
