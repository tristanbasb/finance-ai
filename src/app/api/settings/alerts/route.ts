import { readJson, withErrors } from "@/lib/api";
import { getDb } from "@/lib/db";
import { alertPrefs, alertPrefsSchema, setSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export const GET = withErrors(async () => Response.json(alertPrefs(getDb())));

/** Objet complet ou partiel (fusionné avec les réglages actuels), validé puis enregistré. */
export const PUT = withErrors(async (req: Request) => {
  const db = getDb();
  const patch = alertPrefsSchema.partial().parse(await readJson(req));
  const saved = alertPrefsSchema.parse({ ...alertPrefs(db), ...patch });
  setSetting(db, "alerts", saved);
  return Response.json(saved);
});
