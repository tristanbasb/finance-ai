const MAX_KEYS = 1000;

export interface RateLimiter {
  /** `true` si la clé a atteint le nombre maximal d'échecs dans la fenêtre. */
  isBlocked(key: string, now?: number): boolean;
  /** Enregistre un échec (les succès ne sont jamais enregistrés). */
  recordFailure(key: string, now?: number): void;
}

/**
 * Limiteur d'échecs à fenêtre glissante, en mémoire. Les entrées expirées sont purgées à
 * l'accès et le nombre de clés est plafonné (la plus ancienne est évincée) afin que des clés
 * usurpées ne fassent pas croître la mémoire sans limite.
 */
export function createRateLimiter(
  max: number,
  windowMs: number,
  maxKeys: number = MAX_KEYS,
): RateLimiter {
  const failures = new Map<string, number[]>();

  function recent(key: string, now: number): number[] {
    const list = failures.get(key);
    if (!list) return [];
    const kept = list.filter((t) => now - t < windowMs);
    if (kept.length === 0) failures.delete(key);
    else if (kept.length !== list.length) failures.set(key, kept);
    return kept;
  }

  return {
    isBlocked(key, now = Date.now()) {
      return recent(key, now).length >= max;
    },
    recordFailure(key, now = Date.now()) {
      const kept = recent(key, now);
      kept.push(now);
      // delete + set : la clé la plus récemment utilisée passe en fin d'itération.
      failures.delete(key);
      failures.set(key, kept);
      while (failures.size > maxKeys) {
        const oldest = failures.keys().next().value;
        if (oldest === undefined) break;
        failures.delete(oldest);
      }
    },
  };
}

export const GLOBAL_KEY = "global";

/**
 * Clé de limitation par client. `x-forwarded-for` est contrôlé par le client : on ne s'y fie
 * (valeur la plus à droite, ajoutée par notre proxy) que si TRUST_PROXY=true ; sinon clé unique.
 */
export function clientKey(xff: string | null, trustProxy: boolean): string {
  if (!trustProxy || !xff) return GLOBAL_KEY;
  const parts = xff
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : GLOBAL_KEY;
}
