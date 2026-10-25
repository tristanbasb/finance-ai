import { after } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { runAlertChecks, type AlertScope } from "./engine";

/** Lance les contrôles d'alerte après l'envoi de la réponse HTTP ; n'échoue jamais. */
export function scheduleAlertChecks(scope: AlertScope): void {
  try {
    after(() => runAlertChecks(getDb(), scope));
  } catch (err) {
    console.error("[alerts] planification impossible :", err);
  }
}

/**
 * Contrôles d'alerte sur une base donnée : après la réponse HTTP dans une requête, tout de suite
 * hors requête (`after` indisponible : bot Telegram, tâches). N'échoue jamais.
 */
export function runAlertChecksSoon(db: Db, scope: AlertScope): void {
  try {
    after(() => runAlertChecks(db, scope));
  } catch {
    void runAlertChecks(db, scope);
  }
}
