import { getDb } from "@/lib/db";
import { scheduleAlertChecks } from "@/lib/alerts/trigger";
import { readJson, withErrors } from "@/lib/api";
import { createTransaction, listTransactions } from "@/lib/queries/transactions";
import { transactionFilters, transactionInput } from "@/lib/validation";

export const dynamic = "force-dynamic";

export const GET = withErrors(async (req: Request) => {
  const params = new URL(req.url).searchParams;
  const filters = transactionFilters.parse(Object.fromEntries(params));
  return Response.json(listTransactions(getDb(), filters));
});

export const POST = withErrors(async (req: Request) => {
  const input = transactionInput.parse(await readJson(req));
  const created = createTransaction(getDb(), input);
  scheduleAlertChecks({ txIds: [created.id], goals: true });
  return Response.json(created, { status: 201 });
});
