import { gte } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { snapshots } from "@/lib/db/schema";
import { todayLocal } from "@/lib/dates";
import { getOverview } from "./overview";

export type SnapshotRow = {
  date: string;
  netWorth: number;
  cash: number;
  investments: number;
};

/** Enregistre (ou remplace) le snapshot du jour `today` (YYYY-MM-DD) à partir du tableau de bord. */
export function recordSnapshot(db: Db, today: string): void {
  const { netWorth, cash, investments } = getOverview(db, today);
  db.insert(snapshots)
    .values({ date: today, netWorth, cash, investments })
    .onConflictDoUpdate({ target: snapshots.date, set: { netWorth, cash, investments } })
    .run();
}

/** Snapshots des `days` derniers jours (aujourd'hui inclus), par date croissante. */
export function listSnapshots(db: Db, days: number, now: Date = new Date()): SnapshotRow[] {
  const from = new Date(now);
  from.setDate(from.getDate() - (days - 1));
  return db
    .select()
    .from(snapshots)
    .where(gte(snapshots.date, todayLocal(from)))
    .orderBy(snapshots.date)
    .all();
}
