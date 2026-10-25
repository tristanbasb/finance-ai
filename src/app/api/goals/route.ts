import { getDb } from "@/lib/db";
import { scheduleAlertChecks } from "@/lib/alerts/trigger";
import { readJson, withErrors } from "@/lib/api";
import { createGoal, listGoals } from "@/lib/queries/goals";
import { goalInput } from "@/lib/validation";

export const dynamic = "force-dynamic";

export const GET = withErrors(async () => Response.json(listGoals(getDb())));

export const POST = withErrors(async (req: Request) => {
  const input = goalInput.parse(await readJson(req));
  const created = createGoal(getDb(), input);
  scheduleAlertChecks({ goals: true });
  return Response.json(created, { status: 201 });
});
