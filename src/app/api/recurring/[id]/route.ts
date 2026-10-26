import { parseId, readJson, withErrors } from "@/lib/api";
import { getDb } from "@/lib/db";
import { deleteRecurring, updateRecurring } from "@/lib/queries/recurring";
import { recurringPatch } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withErrors(async (req: Request, { params }: Ctx) => {
  const id = await parseId(params);
  const patch = recurringPatch.parse(await readJson(req));
  return Response.json(updateRecurring(getDb(), id, patch));
});

export const DELETE = withErrors(async (_req: Request, { params }: Ctx) => {
  deleteRecurring(getDb(), await parseId(params));
  return new Response(null, { status: 204 });
});
