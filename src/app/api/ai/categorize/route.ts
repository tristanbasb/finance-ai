import { z } from "zod";
import { readJson } from "@/lib/api";
import { getDb } from "@/lib/db";
import { categorize, MAX_LABELS } from "@/lib/ai/categorize";
import { requireAi } from "@/lib/ai/client";
import { withAiErrors } from "@/lib/ai/route";
import { listCategories } from "@/lib/queries/categories";

export const dynamic = "force-dynamic";

const body = z.object({ labels: z.array(z.string().max(1000)).min(1).max(MAX_LABELS) });

/** `{ labels }` → `{ categoryIds }` (même ordre, null si aucune suggestion). */
export const POST = withAiErrors(async (req: Request) => {
  const ai = requireAi();
  const { labels } = body.parse(await readJson(req));
  const categories = listCategories(getDb()).map((c) => ({ id: c.id, name: c.name, kind: c.kind }));
  return Response.json({ categoryIds: await categorize(labels, categories, ai) });
});
