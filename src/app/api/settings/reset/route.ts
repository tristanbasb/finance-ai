import { z } from "zod";
import { readJson, withErrors } from "@/lib/api";
import { verifyPassword } from "@/lib/auth/password";
import { clientKey, createRateLimiter } from "@/lib/auth/rate-limit";
import { getDb } from "@/lib/db";
import { withGenerationLock } from "@/lib/assistant/lock";
import { backupBeforeReset, backupDir, RESET_CONFIRMATION, resetDatabase } from "@/lib/reset";

export const dynamic = "force-dynamic";

const body = z.object({
  password: z.string().min(1).max(1024),
  confirmation: z.string().max(64),
});

// Mots de passe erronés seulement : 5 par 15 min et par client (en mémoire, instance unique).
const limiter = createRateLimiter(5, 15 * 60 * 1000);

/**
 * Réinitialise toutes les données : `{ password, confirmation: "RÉINITIALISER" }`.
 * Sauvegarde complète de la base d'abord (rien n'est effacé si elle échoue), puis effacement en
 * une transaction, après les réponses de Claude en cours (verrou de génération).
 * 200 `{ backup }` (nom du fichier) ; 400 confirmation ; 401 mot de passe ; 429 trop d'essais.
 */
export const POST = withErrors(async (req: Request) => {
  const hash = process.env.APP_PASSWORD_HASH;
  if (!hash) return Response.json({ error: "Configuration manquante : lancez install.sh" }, { status: 500 });

  const { password, confirmation } = body.parse(await readJson(req));
  if (confirmation.trim().toLocaleUpperCase("fr-FR") !== RESET_CONFIRMATION) {
    return Response.json({ error: `Saisissez ${RESET_CONFIRMATION} pour confirmer.` }, { status: 400 });
  }

  const key = clientKey(req.headers.get("x-forwarded-for"), process.env.TRUST_PROXY === "true");
  const reservation = limiter.reserve(key);
  if (!reservation) {
    return Response.json({ error: "Trop de tentatives, réessayez dans quelques minutes." }, { status: 429 });
  }
  if (!(await verifyPassword(password, hash))) {
    return Response.json({ error: "Mot de passe incorrect" }, { status: 401 });
  }
  reservation.release();

  const db = getDb();
  const file = await withGenerationLock(async () => {
    const saved = await backupBeforeReset(db, backupDir());
    resetDatabase(db);
    return saved;
  });
  console.info(`[reset] données réinitialisées ; sauvegarde : ${file}`);
  return Response.json({ backup: file.split(/[\\/]/).pop() });
});
