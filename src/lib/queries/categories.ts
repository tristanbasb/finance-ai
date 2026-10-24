import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { categories } from "@/lib/db/schema";
import { NotFoundError } from "@/lib/api";
import type { CategoryInput } from "@/lib/validation";

export type Category = typeof categories.$inferSelect;

export function listCategories(db: Db): Category[] {
  return db.select().from(categories).orderBy(categories.id).all();
}

export function createCategory(db: Db, input: CategoryInput): Category {
  return db.insert(categories).values(input).returning().get();
}

export function updateCategory(db: Db, id: number, patch: Partial<CategoryInput>): Category {
  const current = db.select().from(categories).where(eq(categories.id, id)).get();
  if (!current) throw new NotFoundError();
  if (Object.keys(patch).length === 0) return current;
  return db.update(categories).set(patch).where(eq(categories.id, id)).returning().get()!;
}

/** Les transactions de la catégorie sont conservées (`categoryId` passe à null via la clé étrangère). */
export function deleteCategory(db: Db, id: number): void {
  const deleted = db.delete(categories).where(eq(categories.id, id)).returning({ id: categories.id }).all();
  if (deleted.length === 0) throw new NotFoundError();
}
