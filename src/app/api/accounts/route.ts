import { getDb } from "@/lib/db";
import { readJson, withErrors } from "@/lib/api";
import { createAccount, listAccountsWithBalances } from "@/lib/queries/accounts";
import { accountInput } from "@/lib/validation";

export const dynamic = "force-dynamic";

export const GET = withErrors(async () => Response.json(listAccountsWithBalances(getDb())));

export const POST = withErrors(async (req: Request) => {
  const input = accountInput.parse(await readJson(req));
  return Response.json(createAccount(getDb(), input), { status: 201 });
});
