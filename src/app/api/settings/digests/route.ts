import { readJson, withErrors } from "@/lib/api";
import { getDb } from "@/lib/db";
import { digestPrefs, digestPrefsSchema, mergePrefs, setSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export const GET = withErrors(async () => Response.json(digestPrefs(getDb())));

/** Objet complet ou partiel (fusionné avec les réglages actuels), validé puis enregistré. */
export const PUT = withErrors(async (req: Request) => {
  const db = getDb();
  const saved = mergePrefs(digestPrefsSchema, digestPrefs(db), await readJson(req));
  setSetting(db, "digests", saved);
  return Response.json(saved);
});
