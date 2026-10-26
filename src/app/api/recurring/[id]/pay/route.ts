import { scheduleAlertChecks } from "@/lib/alerts/trigger";
import { parseId, readJson, withErrors } from "@/lib/api";
import { getDb } from "@/lib/db";
import { payRecurring } from "@/lib/queries/recurring";
import { recurringPayInput } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** `{ period, amount, date, accountId }` → 201 `{ transaction }` ; 409 si le mois est déjà validé ou passé. */
export const POST = withErrors(async (req: Request, { params }: Ctx) => {
  const id = await parseId(params);
  const input = recurringPayInput.parse(await readJson(req));
  const transaction = payRecurring(getDb(), id, input);
  scheduleAlertChecks({ txIds: [transaction.id], goals: true });
  return Response.json({ transaction }, { status: 201 });
});
