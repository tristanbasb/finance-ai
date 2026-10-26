import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { seedDefaults } from "@/lib/db/seed";
import { categories, recurringPayments, transactions } from "@/lib/db/schema";
import { createAccount } from "@/lib/queries/accounts";
import { deleteTransaction } from "@/lib/queries/transactions";
import { todayLocal } from "@/lib/dates";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", async (orig) => ({ ...(await orig<typeof import("@/lib/db")>()), getDb: () => state.db }));
const schedule = vi.hoisted(() => vi.fn());
vi.mock("@/lib/alerts/trigger", () => ({ scheduleAlertChecks: schedule }));

import { GET as listGET, POST as createPOST } from "@/app/api/recurring/route";
import { PATCH, DELETE } from "@/app/api/recurring/[id]/route";
import { POST as payPOST } from "@/app/api/recurring/[id]/pay/route";
import { POST as skipPOST } from "@/app/api/recurring/[id]/skip/route";
import { DELETE as undoDELETE } from "@/app/api/recurring/[id]/payments/[period]/route";
import { GET as forecastGET } from "@/app/api/forecast/route";
import { GET as marginGET, PUT as marginPUT } from "@/app/api/settings/forecast-margin/route";

type TestDb = ReturnType<typeof createDb>;
const db = () => state.db as TestDb;
const period = todayLocal().slice(0, 7);
const date = `${period}-05`;

function req(method: string, body?: unknown, url = "http://x/api") {
  return new Request(url, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}
const idCtx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const getForecast = (q = "") => forecastGET(req("GET", undefined, `http://x/api/forecast${q}`));

let checkingId: number;
let expenseCat: number;
let incomeCat: number;

function makeRecurring(over: Record<string, unknown> = {}) {
  return createPOST(
    req("POST", {
      label: "Loyer",
      amount: 80_000,
      categoryId: expenseCat,
      accountId: checkingId,
      frequency: "monthly",
      anchorMonth: null,
      ...over,
    }),
  );
}
async function recurringId(over: Record<string, unknown> = {}): Promise<number> {
  const res = await makeRecurring(over);
  expect(res.status).toBe(201);
  return (await res.json()).id;
}
const payBody = (over: Record<string, unknown> = {}) => ({ period, amount: 80_000, date, accountId: checkingId, ...over });
const loyerRows = () => db().select().from(transactions).where(eq(transactions.label, "Loyer")).all();

beforeEach(() => {
  schedule.mockClear();
  const d = createDb(":memory:");
  runMigrations(d);
  seedDefaults(d);
  state.db = d;
  checkingId = createAccount(d, { name: "Courant test", type: "checking", initialBalance: 200_000 }).id;
  expenseCat = d.select().from(categories).where(eq(categories.kind, "expense")).get()!.id;
  incomeCat = d.select().from(categories).where(eq(categories.kind, "income")).get()!.id;
});

describe("/api/recurring", () => {
  it("crée, liste, modifie et supprime", async () => {
    const id = await recurringId();
    const list = await (await listGET()).json();
    expect(list.items).toHaveLength(1);
    const patched = await PATCH(req("PATCH", { amount: 90_000 }), idCtx(id));
    expect(patched.status).toBe(200);
    expect((await patched.json()).amount).toBe(90_000);
    expect((await DELETE(req("DELETE"), idCtx(id))).status).toBe(204);
    expect((await DELETE(req("DELETE"), idCtx(id))).status).toBe(404);
  });

  it("refuse une catégorie de revenu, un compte ou une catégorie inconnus", async () => {
    expect((await makeRecurring({ categoryId: incomeCat })).status).toBe(400);
    expect((await makeRecurring({ categoryId: 9999 })).status).toBe(400);
    expect((await makeRecurring({ accountId: 9999 })).status).toBe(400);
    const id = await recurringId();
    expect((await PATCH(req("PATCH", { categoryId: incomeCat }), idCtx(id))).status).toBe(400);
    expect((await PATCH(req("PATCH", { accountId: 9999 }), idCtx(id))).status).toBe(400);
  });

  it("refuse une trimestrielle sans mois de référence", async () => {
    expect((await makeRecurring({ frequency: "quarterly", anchorMonth: null })).status).toBe(400);
  });
});

describe("POST /api/recurring/[id]/pay", () => {
  it("crée l'opération (montant négatif) et le statut payé", async () => {
    const id = await recurringId();
    const res = await payPOST(req("POST", payBody()), idCtx(id));
    expect(res.status).toBe(201);
    const { transaction } = await res.json();
    expect(transaction).toMatchObject({ amount: -80_000, label: "Loyer", categoryId: expenseCat, accountId: checkingId, date });
    expect(schedule).toHaveBeenCalledWith({ txIds: [transaction.id], goals: true });
    const f = await (await getForecast()).json();
    const item = f.items.find((i: { id: number }) => i.id === id);
    expect(item.status).toBe("paid");
    expect(item.transactionId).toBe(transaction.id);
  });

  it("refuse un second paiement du même mois (409) sans doubler l'opération", async () => {
    const id = await recurringId();
    expect((await payPOST(req("POST", payBody()), idCtx(id))).status).toBe(201);
    const second = await payPOST(req("POST", payBody()), idCtx(id));
    expect(second.status).toBe(409);
    expect((await second.json()).error).toBe("Déjà validée pour ce mois.");
    expect(loyerRows()).toHaveLength(1);
  });

  it("deux requêtes simultanées : un 201 et un 409", async () => {
    const id = await recurringId();
    const res = await Promise.all([payPOST(req("POST", payBody()), idCtx(id)), payPOST(req("POST", payBody()), idCtx(id))]);
    expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(loyerRows()).toHaveLength(1);
  });

  it("refuse un compte archivé (400) et un compte inconnu (400)", async () => {
    const id = await recurringId();
    const archived = createAccount(db(), { name: "Vieux", type: "checking", archived: true });
    expect((await payPOST(req("POST", payBody({ accountId: archived.id })), idCtx(id))).status).toBe(400);
    expect((await payPOST(req("POST", payBody({ accountId: 9999 })), idCtx(id))).status).toBe(400);
    expect(db().select().from(recurringPayments).all()).toHaveLength(0);
  });

  it("404 si la récurrente n'existe pas, 400 si le corps est invalide", async () => {
    expect((await payPOST(req("POST", payBody()), idCtx(999))).status).toBe(404);
    const id = await recurringId();
    for (const bad of [
      { period: "2026-13" },
      { period: "2026-1" },
      { date: "2026-02-30" },
      { date: "05/10/2026" },
      { amount: 0 },
      { amount: -5 },
      { amount: 1.5 },
      { amount: 100_000_000_000 },
      { accountId: 0 },
    ]) {
      expect((await payPOST(req("POST", payBody(bad)), idCtx(id))).status, JSON.stringify(bad)).toBe(400);
    }
  });
});

describe("POST /api/recurring/[id]/skip", () => {
  it("passe le mois, puis pay est refusé (409)", async () => {
    const id = await recurringId();
    expect((await skipPOST(req("POST", { period }), idCtx(id))).status).toBe(201);
    const f = await (await getForecast()).json();
    expect(f.items.find((i: { id: number }) => i.id === id).status).toBe("skipped");
    expect((await payPOST(req("POST", payBody()), idCtx(id))).status).toBe(409);
    expect((await skipPOST(req("POST", { period }), idCtx(id))).status).toBe(409);
  });

  it("période invalide : 400 ; récurrente inconnue : 404", async () => {
    const id = await recurringId();
    expect((await skipPOST(req("POST", { period: "2026-13" }), idCtx(id))).status).toBe(400);
    expect((await skipPOST(req("POST", { period }), idCtx(999))).status).toBe(404);
  });
});

describe("DELETE /api/recurring/[id]/payments/[period]", () => {
  const ctx = (id: number, p: string) => ({ params: Promise.resolve({ id: String(id), period: p }) });

  it("annule un paiement : supprime l'opération liée", async () => {
    const id = await recurringId();
    const { transaction } = await (await payPOST(req("POST", payBody()), idCtx(id))).json();
    expect((await undoDELETE(req("DELETE"), ctx(id, period))).status).toBe(204);
    expect(db().select().from(transactions).where(eq(transactions.id, transaction.id)).all()).toHaveLength(0);
    expect(db().select().from(recurringPayments).all()).toHaveLength(0);
  });

  it("annule un saut ; 404 sans paiement ; 400 période invalide", async () => {
    const id = await recurringId();
    await skipPOST(req("POST", { period }), idCtx(id));
    expect((await undoDELETE(req("DELETE"), ctx(id, period))).status).toBe(204);
    expect((await undoDELETE(req("DELETE"), ctx(id, period))).status).toBe(404);
    expect((await undoDELETE(req("DELETE"), ctx(id, "2026-13"))).status).toBe(400);
  });

  it("supprimer l'opération elle-même remet la récurrente à payer", async () => {
    const id = await recurringId();
    const { transaction } = await (await payPOST(req("POST", payBody()), idCtx(id))).json();
    deleteTransaction(db(), transaction.id);
    const f = await (await getForecast()).json();
    expect(f.items.find((i: { id: number }) => i.id === id).status).toBe("due");
  });
});

describe("GET /api/forecast", () => {
  it("calcule la prévision ; price=40000 est abordable", async () => {
    await recurringId();
    const base = await (await getForecast()).json();
    expect(base).toMatchObject({ checkingBalance: 200_000, dueTotal: 80_000, forecast: 120_000, margin: 20_000 });
    expect(base.afford).toBeUndefined();
    const f = await (await getForecast("?price=40000")).json();
    expect(f.afford.ok).toBe(true);
    expect(f.afford.remaining).toBe(80_000);
  });

  it("refuse un prix invalide", async () => {
    for (const p of ["abc", "0", "-5", "1.5", "100000000000", ""]) {
      expect((await getForecast(`?price=${p}`)).status, p).toBe(400);
    }
  });
});

describe("/api/settings/forecast-margin", () => {
  it("lit et enregistre la marge, refuse les valeurs invalides", async () => {
    expect(await (await marginGET()).json()).toEqual({ margin: 20_000 });
    const put = await marginPUT(req("PUT", { margin: 5_000 }));
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ margin: 5_000 });
    expect(await (await marginGET()).json()).toEqual({ margin: 5_000 });
    expect((await marginPUT(req("PUT", { margin: -1 }))).status).toBe(400);
    expect((await marginPUT(req("PUT", { margin: 1.5 }))).status).toBe(400);
    expect((await marginPUT(req("PUT", { margin: "x" }))).status).toBe(400);
  });
});
