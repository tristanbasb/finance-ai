import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

/** Ouvre une nouvelle connexion (sans singleton) avec les pragmas appliqués. */
export function createDb(dbPath: string) {
  const sqlite = new Database(dbPath);
  if (dbPath !== ":memory:") sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

export type Db = ReturnType<typeof createDb>;

let instance: Db | undefined;

/** Singleton paresseux ; chemin via `DATABASE_PATH` (défaut `./data/finance.db`). */
export function getDb(): Db {
  if (!instance) {
    const dbPath = process.env.DATABASE_PATH ?? "./data/finance.db";
    if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    instance = createDb(dbPath);
  }
  return instance;
}
