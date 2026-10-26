import { z } from "zod";
import { readJson, withErrors } from "@/lib/api";
import { getDb } from "@/lib/db";
import { getForecastMargin, setForecastMargin } from "@/lib/settings";

export const dynamic = "force-dynamic";

const body = z.object({ margin: z.number().int().min(0).max(99_999_999_999) });

/** Marge de sécurité de la prévision, en centimes (20 000 par défaut). */
export const GET = withErrors(async () => Response.json({ margin: getForecastMargin(getDb()) }));

/** `{ margin }` entier >= 0 → 200 `{ margin }` ; 400 sinon. */
export const PUT = withErrors(async (req: Request) => {
  const { margin } = body.parse(await readJson(req));
  setForecastMargin(getDb(), margin);
  return Response.json({ margin });
});
