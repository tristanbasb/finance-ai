import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "@/lib/auth/password";
import { createDb } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { seedDefaults } from "@/lib/db/seed";
import { accounts, categories, goals, holdings, jobRuns, messages, recurring, recurringPayments, settings, transactions } from "@/lib/db/schema";
import { backupBeforeReset, resetDatabase } from "@/lib/reset";
import { setAiCanWrite } from "@/lib/settings";
import { createTransaction } from "@/lib/queries/transactions";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", async (orig) => ({ ...(await orig<typeof import("@/lib/db")>()), getDb: () => state.db }));

type Db = ReturnType<typeof createDb>;

function freshDb(): Db {
  const db = createDb(":memory:");
  runMigrations(db);
  seedDefaults(db);
  return db;
}

/** Base « utilisée » : opérations, objectif, position, message, réglage, catégorie ajoutée. */
function fill(db: Db) {
  const acc = db.select().from(accounts).get()!;
  db.update(accounts).set({ initialBalance: 72_986 }).run();
  createTransaction(db, { accountId: acc.id, categoryId: null, date: "2026-10-10", amount: -1_250, label: "Boulangerie" });
  db.insert(categories).values({ name: "Animaux", kind: "expense", color: "#f97316", icon: "circle-ellipsis" }).run();
  db.insert(goals).values({ name: "Vacances", targetAmount: 200_000, currentAmount: 0 }).run();
  db.insert(holdings).values({ accountId: acc.id, symbol: "CW8", name: "MSCI World", assetType: "etf", quantity: 2, avgPrice: 45_000 }).run();
  db.insert(messages).values({ role: "user", kind: "chat", source: "app", content: "Bonjour", createdAt: Date.now() }).run();
  db.insert(jobRuns).values({ job: "weekly", lastPeriod: "2026-W43", lastRunAt: Date.now() }).run();
  setAiCanWrite(db, false);
  const rec = db
    .insert(recurring)
    .values({ label: "Loyer", amount: 50_000, accountId: acc.id, frequency: "monthly", anchorMonth: null })
    .returning()
    .get()!;
  const tx = db.select().from(transactions).get()!;
  db.insert(recurringPayments).values({ recurringId: rec.id, period: "2026-10", transactionId: tx.id }).run();
}

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "finance-reset-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("resetDatabase", () => {
  it("revient à une installation neuve : catégories par défaut, un compte courant vide, rien d'autre", () => {
    const fresh = freshDb();
    const db = freshDb();
    fill(db);
    resetDatabase(db);
    expect(db.select().from(transactions).all()).toEqual([]);
    expect(db.select().from(goals).all()).toEqual([]);
    expect(db.select().from(holdings).all()).toEqual([]);
    expect(db.select().from(messages).all()).toEqual([]);
    expect(db.select().from(settings).all()).toEqual([]);
    expect(db.select().from(recurring).all()).toEqual([]);
    expect(db.select().from(recurringPayments).all()).toEqual([]);
    const strip = <T extends { id: number }>(rows: T[]) =>
      rows.map((row) => ({ ...row, id: 0, createdAt: "createdAt" in row ? 0 : undefined }));
    expect(strip(db.select().from(categories).all())).toEqual(strip(fresh.select().from(categories).all()));
    expect(strip(db.select().from(accounts).all())).toEqual(strip(fresh.select().from(accounts).all()));
  });

  it("garde les compteurs d'identifiants et l'historique des tâches planifiées", () => {
    const db = freshDb();
    fill(db);
    const lastTx = db.select().from(transactions).get()!.id;
    resetDatabase(db);
    const acc = db.select().from(accounts).get()!;
    const tx = createTransaction(db, { accountId: acc.id, categoryId: null, date: "2026-10-11", amount: -100, label: "x" });
    expect(tx.id).toBeGreaterThan(lastTx);
    expect(db.select().from(jobRuns).all()).toHaveLength(1);
  });
});

describe("backupBeforeReset", () => {
  it("écrit une copie complète, lisible, sans écraser une copie existante", async () => {
    const db = freshDb();
    fill(db);
    const now = new Date(2026, 9, 25, 18, 5, 9);
    const first = await backupBeforeReset(db, dir, now);
    const second = await backupBeforeReset(db, dir, now);
    expect(path.basename(first)).toBe("avant-reinitialisation-20261025-180509.db");
    expect(second).not.toBe(first);
    const copy = new Database(first, { readonly: true });
    expect(copy.prepare("select label from transactions").all()).toEqual([{ label: "Boulangerie" }]);
    copy.close();
  });
});

describe("POST /api/settings/reset", () => {
  let POST: (req: Request) => Promise<Response>;

  beforeAll(async () => {
    process.env.APP_PASSWORD_HASH = await hashPassword("bon-mot-de-passe");
  });

  beforeEach(async () => {
    process.env.BACKUP_DIR = dir;
    vi.resetModules();
    ({ POST } = await import("@/app/api/settings/reset/route"));
  });
  afterEach(() => {
    delete process.env.BACKUP_DIR;
  });

  const request = (body: unknown) =>
    new Request("http://x/api/settings/reset", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    });

  it("sauvegarde puis efface avec le bon mot de passe et le mot de confirmation", async () => {
    const db = freshDb();
    fill(db);
    state.db = db;
    const res = await POST(request({ password: "bon-mot-de-passe", confirmation: "réinitialiser" }));
    expect(res.status).toBe(200);
    const { backup } = (await res.json()) as { backup: string };
    expect(backup).toMatch(/^avant-reinitialisation-\d{8}-\d{6}\.db$/);
    expect(fs.existsSync(path.join(dir, backup))).toBe(true);
    expect(db.select().from(transactions).all()).toEqual([]);
  });

  it("mauvais mot de passe ou mauvais mot : rien n'est touché, aucune sauvegarde", async () => {
    const db = freshDb();
    fill(db);
    state.db = db;
    const wrongPassword = await POST(request({ password: "mauvais", confirmation: "RÉINITIALISER" }));
    expect(wrongPassword.status).toBe(401);
    const wrongWord = await POST(request({ password: "bon-mot-de-passe", confirmation: "oui" }));
    expect(wrongWord.status).toBe(400);
    expect(db.select().from(transactions).all()).toHaveLength(1);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("limite les mots de passe erronés à 5 par quart d'heure", async () => {
    state.db = freshDb();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await POST(request({ password: "mauvais", confirmation: "RÉINITIALISER" }))).status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
  });

  it("sauvegarde impossible : rien n'est effacé", async () => {
    const db = freshDb();
    fill(db);
    state.db = db;
    const blocker = path.join(dir, "fichier");
    fs.writeFileSync(blocker, "");
    process.env.BACKUP_DIR = path.join(blocker, "sous-dossier");
    const res = await POST(request({ password: "bon-mot-de-passe", confirmation: "RÉINITIALISER" }));
    expect(res.status).toBe(500);
    expect(db.select().from(transactions).all()).toHaveLength(1);
  });
});
