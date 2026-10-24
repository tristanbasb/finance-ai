const MAX_KEYS = 1000;

/** Tentative réservée ; `release()` la retire (à appeler si elle n'est finalement pas un échec). */
export interface Reservation {
  release(): void;
}

export interface RateLimiter {
  /** `true` si la clé a atteint le nombre maximal de tentatives dans la fenêtre. */
  isBlocked(key: string, now?: number): boolean;
  /**
   * Réserve une tentative de façon synchrone (à appeler avant tout `await`, pour éviter qu'une
   * rafale de requêtes concurrentes passe toutes la vérification). Retourne `null` si la clé est
   * déjà au maximum ; rien n'est alors enregistré, donc la liste ne dépasse jamais `max`.
   */
  reserve(key: string, now?: number): Reservation | null;
}

type Entry = { t: number };

/**
 * Limiteur à fenêtre glissante, en mémoire. Les entrées expirées sont purgées à l'accès et le
 * nombre de clés est plafonné (la plus ancienne est évincée) afin que des clés usurpées ne
 * fassent pas croître la mémoire sans limite.
 */
export function createRateLimiter(
  max: number,
  windowMs: number,
  maxKeys: number = MAX_KEYS,
): RateLimiter {
  const attempts = new Map<string, Entry[]>();

  function recent(key: string, now: number): Entry[] {
    const list = attempts.get(key);
    if (!list) return [];
    const kept = list.filter((e) => now - e.t < windowMs);
    if (kept.length === 0) attempts.delete(key);
    else if (kept.length !== list.length) attempts.set(key, kept);
    return kept;
  }

  return {
    isBlocked(key, now = Date.now()) {
      return recent(key, now).length >= max;
    },
    reserve(key, now = Date.now()) {
      const kept = recent(key, now);
      if (kept.length >= max) return null;
      const entry: Entry = { t: now };
      kept.push(entry);
      // delete + set : la clé la plus récemment utilisée passe en fin d'itération.
      attempts.delete(key);
      attempts.set(key, kept);
      while (attempts.size > maxKeys) {
        const oldest = attempts.keys().next().value;
        if (oldest === undefined) break;
        attempts.delete(oldest);
      }
      return {
        release() {
          const list = attempts.get(key);
          if (!list) return;
          const index = list.indexOf(entry);
          if (index === -1) return;
          list.splice(index, 1);
          if (list.length === 0) attempts.delete(key);
        },
      };
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
