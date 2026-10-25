import { ConflictError, NotFoundError, parseId, withErrors } from "@/lib/api";
import { getDb } from "@/lib/db";
import { undoAndAnnounce } from "@/lib/assistant/undo";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Annule une action de Claude → 200 `{ summary }` (message « Action annulée : … » ajouté au fil
 * et diffusé, Telegram compris) ; 409 `{ error }` si l'annulation est refusée (déjà annulée,
 * plus de 24 h, modifiée depuis) ; 404 si l'action n'existe pas ; 400 si l'id est invalide.
 */
export const POST = withErrors(async (_req: Request, { params }: Ctx) => {
  const id = await parseId(params);
  const outcome = await undoAndAnnounce(getDb(), id);
  if (!outcome.ok) {
    if (outcome.notFound) throw new NotFoundError();
    throw new ConflictError(outcome.reason);
  }
  return Response.json({ summary: outcome.summary });
});
