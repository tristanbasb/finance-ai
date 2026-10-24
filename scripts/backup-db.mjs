#!/usr/bin/env node
// Sauvegarde en ligne et cohérente (API backup de SQLite, compatible WAL) de DATABASE_PATH.
// Usage : node scripts/backup-db.mjs <fichier-destination> [--keep N]
// --keep N : ne conserve que les N sauvegardes `finance-AAAAmmjj-HHMMSS.db` les plus récentes
// du dossier de destination.
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const args = process.argv.slice(2);
let keep = 0;
const keepIndex = args.indexOf("--keep");
if (keepIndex !== -1) {
  keep = Number.parseInt(args[keepIndex + 1] ?? "", 10);
  if (!Number.isInteger(keep) || keep < 1) {
    console.error("--keep attend un entier positif.");
    process.exit(1);
  }
  args.splice(keepIndex, 2);
}

const dest = args[0];
if (!dest || args.length !== 1) {
  console.error("Usage : node scripts/backup-db.mjs <fichier-destination> [--keep N]");
  process.exit(1);
}

const source = process.env.DATABASE_PATH ?? "./data/finance.db";
if (!fs.existsSync(source)) {
  console.error(`Base introuvable : ${source}`);
  process.exit(1);
}
if (fs.existsSync(dest)) {
  console.error(`La destination existe déjà : ${dest}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(path.resolve(dest)), { recursive: true });

const db = new Database(source, { fileMustExist: true });
try {
  await db.backup(dest);
} finally {
  db.close();
}
// La copie hérite du mode WAL : on la repasse en journal classique pour obtenir un fichier
// autonome, lisible partout (y compris en lecture seule). L'app réactive WAL à l'ouverture.
const copy = new Database(dest, { fileMustExist: true });
try {
  copy.pragma("journal_mode = DELETE");
} finally {
  copy.close();
}
console.log(`Sauvegarde écrite : ${dest}`);

if (keep > 0) {
  const dir = path.dirname(path.resolve(dest));
  const backups = fs
    .readdirSync(dir)
    .filter((name) => /^finance-\d{8}-\d{6}\.db$/.test(name))
    .sort()
    .reverse();
  for (const name of backups.slice(keep)) {
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(path.join(dir, name + suffix), { force: true });
    }
    console.log(`Ancienne sauvegarde supprimée : ${name}`);
  }
}
