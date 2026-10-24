import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { seedDefaults } from "@/lib/db/seed";
import { accounts, categories, transactions } from "@/lib/db/schema";

function freshDb() {
  const db = createDb(":memory:");
  runMigrations(db);
  return db;
}

describe("base de données", () => {
  it("applique les migrations et le seed de façon idempotente", () => {
    const db = freshDb();
    seedDefaults(db);
    seedDefaults(db);
    runMigrations(db);

    const cats = db.select().from(categories).all();
    expect(cats).toHaveLength(12);
    expect(cats.filter((c) => c.kind === "expense")).toHaveLength(10);
    expect(cats.filter((c) => c.kind === "income")).toHaveLength(2);
    expect(new Set(cats.map((c) => c.color)).size).toBe(12);

    const accs = db.select().from(accounts).all();
    expect(accs).toHaveLength(1);
    expect(accs[0]).toMatchObject({
      name: "Compte courant",
      type: "checking",
      initialBalance: 0,
      archived: false,
    });
  });

  it("ne crée pas de compte si un compte existe déjà", () => {
    const db = freshDb();
    db.insert(accounts)
      .values({ name: "Livret A", type: "savings", initialBalance: 100000, color: "#000000" })
      .run();
    seedDefaults(db);
    expect(db.select().from(accounts).all()).toHaveLength(1);
  });

  it("met category_id à null quand la catégorie est supprimée", () => {
    const db = freshDb();
    seedDefaults(db);
    const account = db.select().from(accounts).get()!;
    const category = db.select().from(categories).get()!;
    const inserted = db
      .insert(transactions)
      .values({
        accountId: account.id,
        categoryId: category.id,
        date: "2026-10-24",
        amount: -1250,
        label: "Courses",
      })
      .returning()
      .get();
    expect(inserted.categoryId).toBe(category.id);

    db.delete(categories).where(eq(categories.id, category.id)).run();
    const after = db.select().from(transactions).where(eq(transactions.id, inserted.id)).get()!;
    expect(after.categoryId).toBeNull();
  });

  it("refuse de supprimer un compte qui a des transactions", () => {
    const db = freshDb();
    seedDefaults(db);
    const account = db.select().from(accounts).get()!;
    db.insert(transactions)
      .values({ accountId: account.id, date: "2026-10-24", amount: 500, label: "Salaire" })
      .run();
    expect(() => db.delete(accounts).where(eq(accounts.id, account.id)).run()).toThrow();
  });
});
