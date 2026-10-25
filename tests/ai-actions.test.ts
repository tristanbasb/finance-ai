import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { actionStatus, attachActionsToMessage, recordAction, undoAction, type Change } from "@/lib/ai/actions";
import { aiActions, transactions } from "@/lib/db/schema";
import { createDb, type Db } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { seedDefaults } from "@/lib/db/seed";
import { accounts } from "@/lib/db/schema";

let db: Db;
let accountId: number;

beforeEach(() => {
  db = createDb(":memory:");
  runMigrations(db);
  seedDefaults(db);
  accountId = db.insert(accounts).values({ name: "Courant", type: "checking" }).returning().get().id;
});

function addTx(label = "Café", amount = -250) {
  return db.insert(transactions).values({ accountId, date: "2026-10-01", amount, label }).returning().get();
}
const txById = (id: number) => db.select().from(transactions).where(eq(transactions.id, id)).get();

describe("journal", () => {
  it("enregistre et rattache à un message", () => {
    const id = recordAction(db, { tool: "t", summary: "s", changes: [] });
    attachActionsToMessage(db, [id], 42);
    expect(db.select().from(aiActions).where(eq(aiActions.id, id)).get()?.messageId).toBe(42);
    const st = actionStatus(db, id);
    expect(st.undoable).toBe(true);
    expect(st.tool).toBe("t");
  });
});

describe("undoAction", () => {
  it("création : annuler supprime la ligne", () => {
    const tx = addTx();
    const id = recordAction(db, { tool: "add", summary: "Ajout", changes: [{ table: "transactions", id: tx.id, before: null, after: tx }] });
    expect(undoAction(db, id)).toEqual({ ok: true, summary: "Ajout" });
    expect(txById(tx.id)).toBeUndefined();
    expect(actionStatus(db, id).undoneAt).not.toBeNull();
  });

  it("modification : annuler restaure", () => {
    const before = addTx();
    const after = db.update(transactions).set({ label: "Resto", amount: -900 }).where(eq(transactions.id, before.id)).returning().get();
    const id = recordAction(db, { tool: "upd", summary: "Modif", changes: [{ table: "transactions", id: before.id, before, after }] });
    expect(undoAction(db, id).ok).toBe(true);
    expect(txById(before.id)).toEqual(before);
  });

  it("suppression : annuler recrée avec le même id", () => {
    const before = addTx();
    db.delete(transactions).where(eq(transactions.id, before.id)).run();
    const id = recordAction(db, { tool: "del", summary: "Suppr", changes: [{ table: "transactions", id: before.id, before, after: null }] });
    expect(undoAction(db, id).ok).toBe(true);
    expect(txById(before.id)).toEqual(before);
  });

  it("lot : annule 3 modifications", () => {
    const changes: Change[] = [];
    const originals = [addTx("A", -1), addTx("B", -2), addTx("C", -3)];
    for (const b of originals) {
      const after = db.update(transactions).set({ amount: -100 }).where(eq(transactions.id, b.id)).returning().get();
      changes.push({ table: "transactions", id: b.id, before: b, after });
    }
    const id = recordAction(db, { tool: "batch", summary: "Lot", changes });
    expect(undoAction(db, id).ok).toBe(true);
    for (const b of originals) expect(txById(b.id)).toEqual(b);
  });

  it("refuse si déjà annulée", () => {
    const tx = addTx();
    const id = recordAction(db, { tool: "a", summary: "s", changes: [{ table: "transactions", id: tx.id, before: null, after: tx }] });
    undoAction(db, id);
    expect(undoAction(db, id)).toEqual({ ok: false, reason: "Déjà annulée." });
  });

  it("refuse après 24 h", () => {
    const tx = addTx();
    const id = recordAction(db, { tool: "a", summary: "s", changes: [{ table: "transactions", id: tx.id, before: null, after: tx }] });
    const later = Date.now() + 24 * 3600 * 1000 + 1000;
    expect(undoAction(db, id, later)).toEqual({ ok: false, reason: "Plus de 24 h : annulation impossible." });
    expect(txById(tx.id)).toBeDefined();
  });

  it("refuse si la ligne a été modifiée depuis, sans rien changer", () => {
    const before = addTx();
    const after = db.update(transactions).set({ label: "Resto" }).where(eq(transactions.id, before.id)).returning().get();
    const other = addTx("Autre");
    const id = recordAction(db, {
      tool: "upd",
      summary: "s",
      changes: [
        { table: "transactions", id: other.id, before: null, after: other },
        { table: "transactions", id: before.id, before, after },
      ],
    });
    db.update(transactions).set({ label: "Manuel" }).where(eq(transactions.id, before.id)).run();
    const res = undoAction(db, id);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/^Modifié depuis/);
    expect(txById(other.id)).toBeDefined();
    expect(txById(before.id)?.label).toBe("Manuel");
    expect(actionStatus(db, id).undoable).toBe(false);
  });

  it("refuse si la ligne est absente alors qu'elle devrait exister", () => {
    const tx = addTx();
    const id = recordAction(db, { tool: "a", summary: "s", changes: [{ table: "transactions", id: tx.id, before: null, after: tx }] });
    db.delete(transactions).where(eq(transactions.id, tx.id)).run();
    expect(actionStatus(db, id).reason).toMatch(/^Modifié depuis/);
  });

  it("refuse de recréer une ligne supprimée si l'id est réutilisé", () => {
    const before = addTx();
    db.delete(transactions).where(eq(transactions.id, before.id)).run();
    const id = recordAction(db, { tool: "del", summary: "s", changes: [{ table: "transactions", id: before.id, before, after: null }] });
    db.insert(transactions).values({ ...before }).run();
    expect(actionStatus(db, id).undoable).toBe(false);
  });

  it("rollback complet si une restauration échoue", () => {
    const tx = addTx();
    db.delete(transactions).where(eq(transactions.id, tx.id)).run();
    // before référence un compte inexistant -> la clé étrangère fait échouer l'insertion
    const bad = { ...tx, accountId: 9999 };
    const created = addTx("Créée");
    const id = recordAction(db, {
      tool: "x",
      summary: "s",
      changes: [
        { table: "transactions", id: tx.id, before: bad, after: null },
        { table: "transactions", id: created.id, before: null, after: created },
      ],
    });
    const res = undoAction(db, id);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/^Annulation impossible/);
    expect(txById(created.id)).toBeDefined();
    expect(txById(tx.id)).toBeUndefined();
    expect(actionStatus(db, id).undoneAt).toBeNull();
  });
});
