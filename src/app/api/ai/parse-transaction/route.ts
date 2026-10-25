import { z } from "zod";
import { readJson } from "@/lib/api";
import { getDb } from "@/lib/db";
import { isAbortError, requireAi } from "@/lib/ai/client";
import { defaultAccountId, NoAmountError, parseTransaction } from "@/lib/ai/parse-transaction";
import { withAiErrors } from "@/lib/ai/route";
import { todayLocal } from "@/lib/dates";
import { listAccountsWithBalances } from "@/lib/queries/accounts";
import { listCategories } from "@/lib/queries/categories";

export const dynamic = "force-dynamic";

const body = z.object({ text: z.string().trim().min(1).max(500) });

/**
 * `{ text }` -> proposition de transaction (compte par défaut si Claude n'en désigne pas).
 * 422 `{ error, partial }` si aucun montant n'est trouvé (`partial` préremplit le formulaire).
 */
export const POST = withAiErrors(async (req: Request) => {
  const ai = requireAi();
  const { text } = body.parse(await readJson(req));
  const db = getDb();
  const accounts = listAccountsWithBalances(db).map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    archived: a.archived,
  }));
  const categories = listCategories(db).map((c) => ({ id: c.id, name: c.name, kind: c.kind }));
  const fallback = defaultAccountId(accounts);

  try {
    const proposal = await parseTransaction(
      ai,
      { text, today: todayLocal(), categories, accounts },
      req.signal,
    );
    return Response.json({ ...proposal, accountId: proposal.accountId ?? fallback });
  } catch (err) {
    if (err instanceof NoAmountError) {
      return Response.json(
        { error: err.message, partial: { ...err.partial, accountId: err.partial.accountId ?? fallback } },
        { status: 422 },
      );
    }
    if (isAbortError(err)) {
      // Client parti : réponse silencieuse ; sinon le délai de 30 s est écoulé.
      if (req.signal.aborted) return Response.json({ error: "Requête annulée" }, { status: 400 });
      return Response.json({ error: "L'analyse a pris trop de temps, réessayez." }, { status: 504 });
    }
    throw err;
  }
});
