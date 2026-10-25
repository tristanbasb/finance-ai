import { z } from "zod";
import { getDb } from "@/lib/db";
import { scheduleAlertChecks } from "@/lib/alerts/trigger";
import { BadRequestError, withErrors } from "@/lib/api";
import { todayLocal } from "@/lib/dates";
import { refreshPrices } from "@/lib/prices";
import { realPriceDeps } from "@/lib/prices/real-deps";
import { recordSnapshot } from "@/lib/queries/snapshots";

export const dynamic = "force-dynamic";

const body = z.object({ force: z.boolean().optional() });

export const POST = withErrors(async (req: Request) => {
  // Corps facultatif : clic utilisateur, donc `force` vaut true par défaut.
  const raw = await req.text();
  let json: unknown = {};
  if (raw.trim()) {
    try {
      json = JSON.parse(raw);
    } catch {
      throw new BadRequestError("Corps JSON invalide");
    }
  }
  const { force = true } = body.parse(json);
  const db = getDb();
  const result = await refreshPrices(db, realPriceDeps(), new Date(), force);
  recordSnapshot(db, todayLocal());
  scheduleAlertChecks({ prices: true, goals: true });
  return Response.json(result);
});
