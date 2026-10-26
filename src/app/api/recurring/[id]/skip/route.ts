import { parseId, readJson, withErrors } from "@/lib/api";
import { getDb } from "@/lib/db";
import { skipRecurring } from "@/lib/queries/recurring";
import { recurringSkipInput } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** `{ period }` → 201 `{ ok: true }` ; 409 si le mois est déjà validé ou passé. */
export const POST = withErrors(async (req: Request, { params }: Ctx) => {
  const id = await parseId(params);
  const { period } = recurringSkipInput.parse(await readJson(req));
  skipRecurring(getDb(), id, period);
  return Response.json({ ok: true }, { status: 201 });
});
