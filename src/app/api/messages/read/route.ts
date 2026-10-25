import { z } from "zod";
import { readJson, withErrors } from "@/lib/api";
import { getDb } from "@/lib/db";
import { markRead } from "@/lib/queries/messages";

export const dynamic = "force-dynamic";

const body = z.union([
  z.strictObject({ ids: z.array(z.number().int().positive()).min(1).max(200) }),
  z.strictObject({ all: z.literal(true) }),
]);

/** `{ ids: number[] }` ou `{ all: true }` → `{ updated }` (messages assistant marqués lus). */
export const POST = withErrors(async (req: Request) => {
  const target = body.parse(await readJson(req));
  return Response.json({ updated: markRead(getDb(), target) });
});
