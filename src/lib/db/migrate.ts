import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { Db } from "./index";

/** Applique les migrations du dossier `drizzle/` (relatif au répertoire de travail). */
export function runMigrations(db: Db): void {
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
}
