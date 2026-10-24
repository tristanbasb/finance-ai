import { withErrors } from "@/lib/api";
import { aiErrorInfo } from "./client";

/**
 * Comme `withErrors`, en traduisant d'abord les erreurs IA : clé absente → 503, clé invalide → 502,
 * limite de débit → 429, autre erreur de l'API Claude → 502 (`{ error }` en français).
 */
export function withAiErrors<A extends unknown[]>(
  handler: (...args: A) => Promise<Response> | Response,
): (...args: A) => Promise<Response> {
  return withErrors(async (...args: A) => {
    try {
      return await handler(...args);
    } catch (err) {
      const info = aiErrorInfo(err);
      if (info) return Response.json({ error: info.message }, { status: info.status });
      throw err;
    }
  });
}
