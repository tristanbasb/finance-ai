import { z } from "zod";
import { withErrors } from "@/lib/api";
import { getDb } from "@/lib/db";
import { actionViews } from "@/lib/ai/actions";

export const dynamic = "force-dynamic";

const MAX_ACTION_IDS = 50;

const query = z.object({
  ids: z
    .string()
    .regex(/^[1-9]\d{0,15}(,[1-9]\d{0,15})*$/, "Liste d'ids attendue (ex. 1,2,3)")
    .transform((s) => [...new Set(s.split(",").map(Number))])
    .pipe(z.array(z.number().int().positive()).max(MAX_ACTION_IDS, `${MAX_ACTION_IDS} ids au plus`)),
});

/**
 * `?ids=1,2,3` (50 au plus) → `{ actions: [{ id, tool, summary, createdAt, undoneAt, undoable,
 * reason?, items }] }` dans l'ordre demandé ; les ids inconnus sont omis. 400 si `ids` est
 * absent ou invalide.
 */
export const GET = withErrors(async (req: Request) => {
  const { ids } = query.parse(Object.fromEntries(new URL(req.url).searchParams));
  return Response.json({ actions: actionViews(getDb(), ids) });
});
