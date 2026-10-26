import { readJson, withErrors } from "@/lib/api";
import { getDb } from "@/lib/db";
import { createRecurring, listRecurring } from "@/lib/queries/recurring";
import { recurringInput } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** `{ items: Recurring[] }`, pausées comprises. */
export const GET = withErrors(async () => Response.json({ items: listRecurring(getDb()) }));

/** Crée une récurrente (201) ; 400 si la catégorie n'est pas une dépense ou si le compte n'existe pas. */
export const POST = withErrors(async (req: Request) => {
  const input = recurringInput.parse(await readJson(req));
  return Response.json(createRecurring(getDb(), input), { status: 201 });
});
