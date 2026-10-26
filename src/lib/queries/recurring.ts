import type { Db } from "@/lib/db";
import { recurring } from "@/lib/db/schema";

export type Recurring = typeof recurring.$inferSelect;

/** Toutes les dépenses récurrentes (pausées comprises), dans l'ordre de création. */
export function listRecurring(db: Db): Recurring[] {
  return db.select().from(recurring).orderBy(recurring.id).all();
}
