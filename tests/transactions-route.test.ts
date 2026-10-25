import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDb } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { seedDefaults } from "@/lib/db/seed";
import { accounts } from "@/lib/db/schema";
import { createTransaction } from "@/lib/queries/transactions";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", async (orig) => ({ ...(await orig<typeof import("@/lib/db")>()), getDb: () => state.db }));
const schedule = vi.hoisted(() => vi.fn());
vi.mock("@/lib/alerts/trigger", () => ({ scheduleAlertChecks: schedule }));

import { PATCH } from "@/app/api/transactions/[id]/route";

beforeEach(() => schedule.mockClear());

describe("PATCH /api/transactions/[id]", () => {
  it("contrôle budget et objectifs, sans la règle des dépenses inhabituelles", async () => {
    const db = createDb(":memory:");
    runMigrations(db);
    seedDefaults(db);
    state.db = db;
    const acc = db.select().from(accounts).get()!;
    const tx = createTransaction(db, { accountId: acc.id, categoryId: null, date: "2026-10-10", amount: -1_000, label: "x" });
    const req = new Request(`http://x/api/transactions/${tx.id}`, {
      method: "PATCH",
      body: JSON.stringify({ amount: -90_000 }),
      headers: { "content-type": "application/json" },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: String(tx.id) }) });
    expect(res.status).toBe(200);
    expect(schedule).toHaveBeenCalledWith({ txIds: [tx.id], goals: true, expenseRule: false });
  });
});
