import { getDb } from "@/lib/db";
import { scheduleAlertChecks } from "@/lib/alerts/trigger";
import { parseId, readJson, withErrors } from "@/lib/api";
import { deleteAccount, updateAccount } from "@/lib/queries/accounts";
import { accountInput } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withErrors(async (req: Request, { params }: Ctx) => {
  const id = await parseId(params);
  const patch = accountInput.partial().parse(await readJson(req));
  const updated = updateAccount(getDb(), id, patch);
  scheduleAlertChecks({ goals: true });
  return Response.json(updated);
});

export const DELETE = withErrors(async (_req: Request, { params }: Ctx) => {
  deleteAccount(getDb(), await parseId(params));
  return new Response(null, { status: 204 });
});
