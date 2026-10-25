import { getDb } from "@/lib/db";
import { scheduleAlertChecks } from "@/lib/alerts/trigger";
import { readJson, withErrors } from "@/lib/api";
import { insertTransactions } from "@/lib/queries/transactions";
import { importInput } from "@/lib/validation";

export const dynamic = "force-dynamic";

export const POST = withErrors(async (req: Request) => {
  const { accountId, rows } = importInput.parse(await readJson(req));
  const ids = insertTransactions(
    getDb(),
    rows.map((r) => ({ ...r, accountId })),
  );
  scheduleAlertChecks({ txIds: ids, goals: true });
  return Response.json({ imported: ids.length }, { status: 201 });
});
