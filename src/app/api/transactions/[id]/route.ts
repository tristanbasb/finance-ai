import { getDb } from "@/lib/db";
import { scheduleAlertChecks } from "@/lib/alerts/trigger";
import { parseId, readJson, withErrors } from "@/lib/api";
import { deleteTransaction, updateTransaction } from "@/lib/queries/transactions";
import { transactionInput } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withErrors(async (req: Request, { params }: Ctx) => {
  const id = await parseId(params);
  const patch = transactionInput.partial().parse(await readJson(req));
  const updated = updateTransaction(getDb(), id, patch);
  scheduleAlertChecks({ txIds: [id], goals: true });
  return Response.json(updated);
});

export const DELETE = withErrors(async (_req: Request, { params }: Ctx) => {
  deleteTransaction(getDb(), await parseId(params));
  return new Response(null, { status: 204 });
});
