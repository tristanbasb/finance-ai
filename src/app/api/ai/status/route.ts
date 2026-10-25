import { effectiveModel, getAi } from "@/lib/ai/client";

export const dynamic = "force-dynamic";

/** État de l'assistant (toujours 200) : activé si une clé est configurée, et modèle effectif. */
export function GET() {
  return Response.json({ enabled: getAi() !== null, model: effectiveModel() });
}
