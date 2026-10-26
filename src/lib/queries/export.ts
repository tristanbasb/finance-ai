import type { Db } from "@/lib/db";
import {
  accounts,
  aiCache,
  categories,
  goals,
  holdings,
  prices,
  recurring,
  recurringPayments,
  snapshots,
  transactions,
} from "@/lib/db/schema";

/** Contenu brut de toutes les tables, pour la sauvegarde JSON. */
export function exportAll(db: Db) {
  return {
    accounts: db.select().from(accounts).all(),
    categories: db.select().from(categories).all(),
    transactions: db.select().from(transactions).all(),
    goals: db.select().from(goals).all(),
    holdings: db.select().from(holdings).all(),
    prices: db.select().from(prices).all(),
    recurring: db.select().from(recurring).all(),
    recurringPayments: db.select().from(recurringPayments).all(),
    snapshots: db.select().from(snapshots).all(),
    aiCache: db.select().from(aiCache).all(),
  };
}
