export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getDb } = await import("./lib/db");
  const { runMigrations } = await import("./lib/db/migrate");
  const { seedDefaults } = await import("./lib/db/seed");
  const db = getDb();
  runMigrations(db);
  seedDefaults(db);
}
