import type { Ai } from "./client";

export type ModelOption = { id: string; name: string };

export const FALLBACK_MODELS: ModelOption[] = [
  { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
  { id: "claude-haiku-5-5", name: "Claude Haiku 5.5" },
  { id: "claude-fable-5-1", name: "Claude Fable 5.1" },
];

export const MODELS_TTL_MS = 24 * 3600 * 1000;

const EFFORT_FAMILIES = ["claude-opus-5", "claude-sonnet-5", "claude-haiku-5", "claude-fable-5"];

/** Fonctionnalités par modèle (liste blanche des familles 5.x ; inconnu → false). */
export function modelSupports(model: string, feature: "effort"): boolean {
  if (feature === "effort") return EFFORT_FAMILIES.some((p) => model.startsWith(p));
  return false;
}

const FAMILY_ORDER = ["opus", "sonnet", "haiku", "fable"];

function familyRank(id: string): number {
  const i = FAMILY_ORDER.findIndex((f) => id.startsWith(`claude-${f}`));
  return i === -1 ? FAMILY_ORDER.length : i;
}

let cache: { key: string; at: number; models: ModelOption[] } | undefined;

/** Réinitialise le cache (tests). */
export function resetModelsCache(): void {
  cache = undefined;
}

/**
 * Modèles `claude-*` disponibles (toutes les pages), triés Opus, Sonnet, Haiku, Fable puis autres
 * (plus récents d'abord). Cache 24 h par clé ; IA absente ou erreur → FALLBACK_MODELS.
 */
export async function listModels(ai: Ai | null, now: number = Date.now()): Promise<ModelOption[]> {
  if (!ai) return FALLBACK_MODELS;
  const key = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
  if (cache && cache.key === key && now - cache.at < MODELS_TTL_MS) return cache.models;
  try {
    const found: { id: string; name: string; created: number; order: number }[] = [];
    let order = 0;
    for await (const m of ai.client.models.list({ limit: 100 })) {
      if (!m.id.startsWith("claude-")) continue;
      const created = Date.parse(m.created_at ?? "");
      found.push({ id: m.id, name: m.display_name || m.id, created: Number.isNaN(created) ? 0 : created, order: order++ });
    }
    if (found.length === 0) return FALLBACK_MODELS;
    found.sort((a, b) => familyRank(a.id) - familyRank(b.id) || b.created - a.created || a.order - b.order);
    const models = found.map(({ id, name }) => ({ id, name }));
    cache = { key, at: now, models };
    return models;
  } catch (err) {
    console.error(`[ai] liste des modèles indisponible : ${err instanceof Error ? err.message : String(err)}`);
    return FALLBACK_MODELS;
  }
}
