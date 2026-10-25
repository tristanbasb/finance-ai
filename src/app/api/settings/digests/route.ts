import { readJson, withErrors } from "@/lib/api";
import { getDb } from "@/lib/db";
import { digestPrefs, digestPrefsSchema, setSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export const GET = withErrors(async () => Response.json(digestPrefs(getDb())));

/** Objet complet ou partiel (fusionné avec les réglages actuels), validé puis enregistré. */
export const PUT = withErrors(async (req: Request) => {
  const db = getDb();
  const patch = digestPrefsSchema.partial().parse(await readJson(req));
  const saved = digestPrefsSchema.parse({ ...digestPrefs(db), ...patch });
  setSetting(db, "digests", saved);
  return Response.json(saved);
});
