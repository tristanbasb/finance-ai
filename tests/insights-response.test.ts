import { describe, expect, it } from "vitest";
import { INSIGHTS_ERROR_FALLBACK, readInsightsResponse } from "@/lib/insights-response";

describe("readInsightsResponse", () => {
  it("200 : observations non vides", () => {
    expect(readInsightsResponse(200, { insights: ["A", " ", 3, "B"] })).toEqual({ kind: "ready", insights: ["A", "B"] });
  });
  it("503 (IA non configurée) ou 404 : état désactivé", () => {
    expect(readInsightsResponse(503, { error: "IA désactivée" })).toEqual({ kind: "disabled" });
    expect(readInsightsResponse(404, null)).toEqual({ kind: "disabled" });
  });
  it("autre erreur : le message `error` du serveur est affiché", () => {
    expect(readInsightsResponse(502, { error: "Clé API Claude invalide" })).toEqual({
      kind: "error",
      message: "Clé API Claude invalide",
    });
  });
  it("erreur sans message lisible, ou réponse 200 malformée : message générique", () => {
    expect(readInsightsResponse(500, null)).toEqual({ kind: "error", message: INSIGHTS_ERROR_FALLBACK });
    expect(readInsightsResponse(429, { error: "" })).toEqual({ kind: "error", message: INSIGHTS_ERROR_FALLBACK });
    expect(readInsightsResponse(200, { autre: 1 })).toEqual({ kind: "error", message: INSIGHTS_ERROR_FALLBACK });
  });
});
