import { after } from "next/server";
import { getDb } from "@/lib/db";
import { runAlertChecks, type AlertScope } from "./engine";

/** Lance les contrôles d'alerte après l'envoi de la réponse HTTP ; n'échoue jamais. */
export function scheduleAlertChecks(scope: AlertScope): void {
  try {
    after(() => runAlertChecks(getDb(), scope));
  } catch (err) {
    console.error("[alerts] planification impossible :", err);
  }
}
