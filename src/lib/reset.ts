import fs from "node:fs";
import path from "node:path";
import type { Db } from "@/lib/db";
import {
  accounts,
  aiActions,
  aiCache,
  alertLog,
  categories,
  goals,
  holdings,
  messages,
  prices,
  recurring,
  recurringPayments,
  settings,
  snapshots,
  transactions,
} from "@/lib/db/schema";
import { seedDefaults } from "@/lib/db/seed";

/** Mot à saisir pour confirmer la réinitialisation. */
export const RESET_CONFIRMATION = "RÉINITIALISER";

/** Dossier des sauvegardes (`./backups`, monté sur le serveur ; `BACKUP_DIR` pour les tests). */
export function backupDir(): string {
  return process.env.BACKUP_DIR ?? "./backups";
}

/** Horodatage local `AAAAMMJJ-HHMMSS` (fuseau du serveur, comme update.sh). */
function stamp(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-` +
    `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  );
}

/**
 * Copie complète et cohérente de la base (API de sauvegarde de SQLite, WAL compris) dans
 * `dir/avant-reinitialisation-AAAAMMJJ-HHMMSS.db`. Renvoie le chemin du fichier.
 */
export async function backupBeforeReset(db: Db, dir: string, now = new Date()): Promise<string> {
  fs.mkdirSync(dir, { recursive: true });
  const base = `avant-reinitialisation-${stamp(now)}`;
  let file = path.join(dir, `${base}.db`);
  for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `${base}-${i}.db`);
  await db.$client.backup(file);
  return file;
}

/**
 * Remet la base à l'état d'une installation neuve (catégories par défaut et un compte courant
 * vide), en une transaction. Les compteurs d'identifiants ne sont pas remis à zéro : un ancien
 * bouton « Annuler » resté sur Telegram ne peut pas désigner une nouvelle action. `job_runs`
 * (dernières exécutions des tâches planifiées) est conservé pour ne pas relancer aussitôt les
 * bilans de la période en cours.
 */
export function resetDatabase(db: Db): void {
  db.transaction((tx) => {
    // Enfants d'abord (clés étrangères).
    for (const table of [aiActions, messages, alertLog, snapshots, aiCache, prices, holdings, goals, recurringPayments, transactions]) {
      tx.delete(table).run();
    }
    tx.delete(recurring).run();
    tx.delete(accounts).run();
    tx.delete(categories).run();
    tx.delete(settings).run();
  });
  seedDefaults(db);
}
