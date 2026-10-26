import { z } from "zod";
import { withErrors } from "@/lib/api";
import { getDb } from "@/lib/db";
import { listNews } from "@/lib/news/store";

export const dynamic = "force-dynamic";

const int = z.string().regex(/^[1-9]\d*$/, "Entier positif attendu").transform(Number).pipe(z.number().int().positive());

const query = z.object({
  symbol: z.string().trim().min(1).max(32).optional(),
  before: int.optional(),
  beforeId: int.optional(),
  limit: int.pipe(z.number().max(50)).default(10),
});

/**
 * `?symbol=AAPL&before=<publishedAt>&beforeId=<id>&limit=10` → `{ items }` : actualités des
 * positions actives, les plus récentes d'abord.
 */
export const GET = withErrors(async (req: Request) => {
  const params = query.parse(Object.fromEntries(new URL(req.url).searchParams));
  return Response.json({ items: listNews(getDb(), params) });
});
