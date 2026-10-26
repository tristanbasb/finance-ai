import { z } from "zod";
import { withErrors } from "@/lib/api";
import { getDb } from "@/lib/db";
import { canAfford, currentPeriod, forecastFor } from "@/lib/forecast";

export const dynamic = "force-dynamic";

const price = z.coerce.number().int().min(1).max(99_999_999_999);

/**
 * Prévision de fin de mois (centimes) : `{ checkingBalance, dueTotal, forecast, margin, items }`.
 * Avec `?price=<centimes>` s'ajoute `afford: { ok, remaining, missing }` ; 400 si le prix est invalide.
 */
export const GET = withErrors(async (req: Request) => {
  const raw = new URL(req.url).searchParams.get("price");
  const result = forecastFor(getDb(), currentPeriod());
  if (raw === null) return Response.json(result);
  const parsed = /^\d+$/.test(raw) ? price.parse(raw) : price.parse(Number.NaN);
  return Response.json({ ...result, afford: canAfford(result.forecast, result.margin, parsed) });
});
