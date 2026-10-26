import { BadRequestError, parseId, withErrors } from "@/lib/api";
import { getDb } from "@/lib/db";
import { undoPayment } from "@/lib/queries/recurring";
import { monthString } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; period: string }> };

/** Annule un paiement ou un saut (supprime l'opération liée) → 204 ; 404 s'il n'y en a pas. */
export const DELETE = withErrors(async (_req: Request, { params }: Ctx) => {
  const id = await parseId(params);
  const period = monthString.safeParse((await params).period);
  if (!period.success) throw new BadRequestError("Période invalide");
  undoPayment(getDb(), id, period.data);
  return new Response(null, { status: 204 });
});
