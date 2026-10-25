import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  actionStatus,
  attachActionsToMessage,
  lastRecentActionId,
  recordAction,
  undoAction,
  type Change,
} from "@/lib/ai/actions";
import { aiActions, categories, goals, transactions } from "@/lib/db/schema";
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
    expect(actionStatus(db, id).reason).toBe("Modifié depuis : opération « Café ».");
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
    const bad = { ...tx, label: null };
    const created = addTx("Créée");
    const id = recordAction(db, {
      tool: "x",
      summary: "s",
      changes: [
        { table: "transactions", id: tx.id, before: bad, after: null },
        { table: "transactions", id: created.id, before: null, after: created },
      ],
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = undoAction(db, id);
    expect(res).toEqual({ ok: false, reason: "Annulation impossible : les données ont changé depuis." });
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
    expect(txById(created.id)).toBeDefined();
    expect(txById(tx.id)).toBeUndefined();
    expect(actionStatus(db, id).undoneAt).toBeNull();
  });

  it("plusieurs changes sur la même ligne : création puis modification", () => {
    const created = addTx("A", -1);
    const after = db.update(transactions).set({ amount: -5 }).where(eq(transactions.id, created.id)).returning().get();
    const id = recordAction(db, { tool: "x", summary: "s", changes: [
      { table: "transactions", id: created.id, before: null, after: created },
      { table: "transactions", id: created.id, before: created, after },
    ] });
    expect(undoAction(db, id).ok).toBe(true);
    expect(txById(created.id)).toBeUndefined();
  });

  it("modification puis modification", () => {
    const b = addTx("A", -1);
    const m1 = db.update(transactions).set({ amount: -2 }).where(eq(transactions.id, b.id)).returning().get();
    const m2 = db.update(transactions).set({ amount: -3 }).where(eq(transactions.id, b.id)).returning().get();
    const id = recordAction(db, { tool: "x", summary: "s", changes: [
      { table: "transactions", id: b.id, before: b, after: m1 },
      { table: "transactions", id: b.id, before: m1, after: m2 },
    ] });
    expect(undoAction(db, id).ok).toBe(true);
    expect(txById(b.id)).toEqual(b);
  });

  it("modification puis suppression", () => {
    const b = addTx("A", -1);
    const m1 = db.update(transactions).set({ amount: -2 }).where(eq(transactions.id, b.id)).returning().get();
    db.delete(transactions).where(eq(transactions.id, b.id)).run();
    const id = recordAction(db, { tool: "x", summary: "s", changes: [
      { table: "transactions", id: b.id, before: b, after: m1 },
      { table: "transactions", id: b.id, before: m1, after: null },
    ] });
    expect(undoAction(db, id).ok).toBe(true);
    expect(txById(b.id)).toEqual(b);
  });

  it("création puis suppression : sans effet", () => {
    const c = addTx("A", -1);
    db.delete(transactions).where(eq(transactions.id, c.id)).run();
    const id = recordAction(db, { tool: "x", summary: "s", changes: [
      { table: "transactions", id: c.id, before: null, after: c },
      { table: "transactions", id: c.id, before: c, after: null },
    ] });
    expect(undoAction(db, id).ok).toBe(true);
    expect(txById(c.id)).toBeUndefined();
  });

  it("refuse d'annuler une catégorie créée utilisée par une autre transaction", () => {
    const cat = db.insert(categories).values({ name: "Nouv", kind: "expense", color: "#fff", icon: "x" }).returning().get();
    const id = recordAction(db, { tool: "x", summary: "s", changes: [{ table: "categories", id: cat.id, before: null, after: cat }] });
    const tx = db.insert(transactions).values({ accountId, categoryId: cat.id, date: "2026-10-01", amount: -1, label: "L" }).returning().get();
    const st = actionStatus(db, id);
    expect(st.undoable).toBe(false);
    expect(st.reason).toBe("Modifié depuis : catégorie « Nouv » est utilisé par d'autres éléments.");
    expect(txById(tx.id)?.categoryId).toBe(cat.id);
  });

  it("autorise l'annulation si les dépendants font partie de l'action", () => {
    const cat = db.insert(categories).values({ name: "Nouv", kind: "expense", color: "#fff", icon: "x" }).returning().get();
    const tx = db.insert(transactions).values({ accountId, categoryId: cat.id, date: "2026-10-01", amount: -1, label: "L" }).returning().get();
    const id = recordAction(db, { tool: "x", summary: "s", changes: [
      { table: "categories", id: cat.id, before: null, after: cat },
      { table: "transactions", id: tx.id, before: null, after: tx },
    ] });
    expect(undoAction(db, id).ok).toBe(true);
    expect(txById(tx.id)).toBeUndefined();
  });

  it("refuse d'annuler un compte créé utilisé par un objectif", () => {
    const acc = db.insert(accounts).values({ name: "Neuf", type: "savings" }).returning().get();
    const id = recordAction(db, { tool: "x", summary: "s", changes: [{ table: "accounts", id: acc.id, before: null, after: acc }] });
    db.insert(goals).values({ name: "G", targetAmount: 100, accountId: acc.id }).run();
    expect(actionStatus(db, id).undoable).toBe(false);
  });

  it("refuse de recréer une ligne dont le compte lié n'existe plus", () => {
    const acc = db.insert(accounts).values({ name: "Tmp", type: "other" }).returning().get();
    const tx = db.insert(transactions).values({ accountId: acc.id, date: "2026-10-01", amount: -1, label: "L" }).returning().get();
    db.delete(transactions).where(eq(transactions.id, tx.id)).run();
    db.delete(accounts).where(eq(accounts.id, acc.id)).run();
    const id = recordAction(db, { tool: "x", summary: "s", changes: [{ table: "transactions", id: tx.id, before: tx, after: null }] });
    expect(undoAction(db, id)).toEqual({ ok: false, reason: "Modifié depuis : le compte ou la catégorie liée n'existe plus." });
  });

  it("journal illisible", () => {
    const bad = [
      "not json",
      JSON.stringify([{ table: "toString", id: 1, before: null, after: null }]),
      JSON.stringify([{ table: "transactions", id: 1, before: null }]),
      JSON.stringify([{ table: "transactions", id: 0, before: null, after: null }]),
    ];
    for (const changes of bad) {
      const row = db.insert(aiActions).values({ tool: "x", summary: "s", changes }).returning().get();
      expect(undoAction(db, row.id)).toEqual({ ok: false, reason: "Journal illisible : annulation impossible." });
    }
  });
});

describe("lastRecentActionId", () => {
  const created = (label: string) => {
    const tx = addTx(label);
    return recordAction(db, { tool: "add", summary: label, changes: [{ table: "transactions", id: tx.id, before: null, after: tx }] });
  };

  it("aucune action → null", () => {
    expect(lastRecentActionId(db, Date.now())).toBeNull();
  });

  it("renvoie la plus récente non annulée de moins de 24 h, même modifiée depuis (pas de recul)", () => {
    const old = created("Ancienne");
    const first = created("Première");
    const modified = created("Modifiée");
    const undone = created("Annulée");
    const now = Date.now();
    db.update(aiActions).set({ createdAt: now - 25 * 3600_000 }).where(eq(aiActions.id, old)).run();
    expect(undoAction(db, undone, now).ok).toBe(true);
    const tx = JSON.parse(db.select().from(aiActions).where(eq(aiActions.id, modified)).get()!.changes)[0].id as number;
    db.update(transactions).set({ label: "Manuel" }).where(eq(transactions.id, tx)).run();
    // L'action modifiée depuis reste la dernière : on ne recule pas vers « Première ».
    expect(lastRecentActionId(db, now)).toBe(modified);
    db.update(transactions).set({ label: "Modifiée" }).where(eq(transactions.id, tx)).run();
    expect(undoAction(db, modified, now).ok).toBe(true);
    expect(lastRecentActionId(db, now)).toBe(first);
    expect(undoAction(db, first, now).ok).toBe(true);
    expect(lastRecentActionId(db, now)).toBeNull();
  });
});
