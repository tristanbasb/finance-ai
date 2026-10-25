import { effectiveModel, getAi } from "@/lib/ai/client";
import { listModels } from "@/lib/ai/models";
import { withErrors } from "@/lib/api";

export const dynamic = "force-dynamic";

/** `{ models, current }` : modèles proposés (secours sans IA) et modèle effectif. */
export const GET = withErrors(async () => {
  return Response.json({ models: await listModels(getAi()), current: effectiveModel() });
});
