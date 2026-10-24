import { getDb } from "@/lib/db";
import { readJson, withErrors } from "@/lib/api";
import { createTransactions } from "@/lib/queries/transactions";
import { importInput } from "@/lib/validation";

export const dynamic = "force-dynamic";

export const POST = withErrors(async (req: Request) => {
  const { accountId, rows } = importInput.parse(await readJson(req));
  const imported = createTransactions(
    getDb(),
    rows.map((r) => ({ ...r, accountId })),
  );
  return Response.json({ imported }, { status: 201 });
});
