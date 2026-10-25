import { readJson, withErrors } from "@/lib/api";
import { getDb } from "@/lib/db";
import { alertPrefs, alertPrefsSchema, mergePrefs, setSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export const GET = withErrors(async () => Response.json(alertPrefs(getDb())));

/** Objet complet ou partiel (fusionné avec les réglages actuels), validé puis enregistré. */
export const PUT = withErrors(async (req: Request) => {
  const db = getDb();
  const saved = mergePrefs(alertPrefsSchema, alertPrefs(db), await readJson(req));
  setSetting(db, "alerts", saved);
  return Response.json(saved);
});
