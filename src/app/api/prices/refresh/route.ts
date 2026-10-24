import { z } from "zod";
import { getDb } from "@/lib/db";
import { BadRequestError, withErrors } from "@/lib/api";
import { todayLocal } from "@/lib/dates";
import { refreshPrices } from "@/lib/prices";
import { coingeckoFetcher } from "@/lib/prices/coingecko";
import { yahooFetcher, yahooFx } from "@/lib/prices/yahoo";
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
  const result = await refreshPrices(
    db,
    { stock: yahooFetcher, crypto: coingeckoFetcher, fx: yahooFx },
    new Date(),
    force,
  );
  recordSnapshot(db, todayLocal());
  return Response.json(result);
});
