import { getDb } from "@/lib/db";
import { readJson, withErrors } from "@/lib/api";
import { createHolding, listHoldingsWithValues } from "@/lib/queries/holdings";
import { holdingInput } from "@/lib/validation";

export const dynamic = "force-dynamic";

export const GET = withErrors(async () => Response.json(listHoldingsWithValues(getDb())));

export const POST = withErrors(async (req: Request) => {
  const input = holdingInput.parse(await readJson(req));
  return Response.json(createHolding(getDb(), input), { status: 201 });
});
