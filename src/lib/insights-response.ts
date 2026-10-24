// Interprétation de la réponse de GET /api/ai/insights (carte « Analyse IA »).

export const INSIGHTS_ERROR_FALLBACK =
  "L'analyse n'a pas pu être générée. Réessayez avec le bouton d'actualisation.";

export type InsightsOutcome =
  | { kind: "disabled" }
  | { kind: "ready"; insights: string[] }
  | { kind: "error"; message: string };

/**
 * 503 (IA non configurée) ou 404 → état désactivé ; autre erreur → message `error` du serveur
 * (ex. « Clé API Claude invalide ») ou message générique ; 200 → observations non vides.
 */
export function readInsightsResponse(status: number, body: unknown): InsightsOutcome {
  const data = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  if (status === 503 || status === 404) return { kind: "disabled" };
  if (status < 200 || status >= 300) {
    const message = typeof data.error === "string" && data.error.trim() !== "" ? data.error : INSIGHTS_ERROR_FALLBACK;
    return { kind: "error", message };
  }
  if (!Array.isArray(data.insights)) return { kind: "error", message: INSIGHTS_ERROR_FALLBACK };
  return {
    kind: "ready",
    insights: data.insights.filter((i): i is string => typeof i === "string" && i.trim() !== ""),
  };
}
