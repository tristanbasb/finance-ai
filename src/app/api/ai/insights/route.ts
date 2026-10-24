import { z } from "zod";
import { getDb } from "@/lib/db";
import { todayLocal } from "@/lib/dates";
import { requireAi } from "@/lib/ai/client";
import { getInsights } from "@/lib/ai/insights";
import { withAiErrors } from "@/lib/ai/route";
import { monthString } from "@/lib/validation";

export const dynamic = "force-dynamic";

const query = z.object({ month: monthString.optional(), refresh: z.enum(["0", "1"]).optional() });

/** `?month=YYYY-MM` (défaut : mois en cours) `&refresh=1` → `{ insights: string[] }`. */
export const GET = withAiErrors(async (req: Request) => {
  const ai = requireAi();
  const params = query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const today = todayLocal();
  const month = params.month ?? today.slice(0, 7);
  return Response.json({ insights: await getInsights(getDb(), month, params.refresh === "1", ai, today) });
});
