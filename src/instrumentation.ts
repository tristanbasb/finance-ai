export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getDb } = await import("./lib/db");
  const { runMigrations } = await import("./lib/db/migrate");
  const { seedDefaults } = await import("./lib/db/seed");
  const db = getDb();
  runMigrations(db);
  seedDefaults(db);

  // Pas de tâches de fond (planificateur, bot Telegram) pendant `next build`. `FINANCE_AI_DISABLE_JOBS=1` les coupe aussi
  // (échappement : dev/diagnostic sans bilans ni actualisation automatique des cours).
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  // Une seule fois : objectifs déjà atteints journalisés sans message, avant toute alerte.
  // Un échec ne doit pas empêcher le planificateur et le bot de démarrer.
  try {
    const { baselineAlerts } = await import("./lib/alerts/engine");
    baselineAlerts(db);
  } catch (err) {
    console.error("[alerts] référence initiale des alertes impossible :", err);
  }
  if (process.env.FINANCE_AI_DISABLE_JOBS === "1") return;
  const { startScheduler } = await import("./lib/jobs/scheduler");
  startScheduler(db);
  // Bot Telegram : sans effet si TELEGRAM_BOT_TOKEN est absent.
  const { startBot } = await import("./lib/telegram/bot");
  startBot(db);
}
