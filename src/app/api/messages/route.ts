import { z } from "zod";
import { withErrors } from "@/lib/api";
import { getDb } from "@/lib/db";
import { listMessages } from "@/lib/queries/messages";

export const dynamic = "force-dynamic";

const int = z.string().regex(/^[1-9]\d*$/, "Entier positif attendu").transform(Number).pipe(z.number().int().positive());

const query = z.object({
  before: int.optional(),
  limit: int.pipe(z.number().max(200)).optional(),
});

/** `?before=<id>&limit=50` → `{ messages }` en ordre chronologique (les plus récents en dernier). */
export const GET = withErrors(async (req: Request) => {
  const params = query.parse(Object.fromEntries(new URL(req.url).searchParams));
  return Response.json({ messages: listMessages(getDb(), params) });
});
