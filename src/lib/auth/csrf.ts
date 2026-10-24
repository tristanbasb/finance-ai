// Protection CSRF des routes /api : refus des requêtes modifiantes venant d'un autre site.

export type CsrfInput = {
  method: string;
  pathname: string;
  /** En-tête Host de la requête. */
  host: string | null;
  origin: string | null;
  secFetchSite: string | null;
  /** En-tête X-Forwarded-Host (pris en compte seulement si `trustProxy`). */
  forwardedHost: string | null;
  trustProxy: boolean;
};

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** `host[:port]` normalisé (minuscules, port par défaut du schéma retiré), ou null si invalide. */
function normalizeHost(host: string, protocol: string): string | null {
  try {
    return new URL(`${protocol}//${host.trim()}`).host;
  } catch {
    return null;
  }
}

/**
 * Vrai si la requête doit être refusée : méthode modifiante vers /api, avec un `Sec-Fetch-Site`
 * autre que same-origin/none, ou un `Origin` dont l'hôte diffère de celui de la requête
 * (`Host`, ou `X-Forwarded-Host` derrière un proxy de confiance). Sans ces en-têtes
 * (curl, scripts), la requête passe : seuls les navigateurs les envoient.
 */
export function isCrossSiteRequest(input: CsrfInput): boolean {
  if (SAFE_METHODS.has(input.method.toUpperCase())) return false;
  if (input.pathname !== "/api" && !input.pathname.startsWith("/api/")) return false;

  const site = input.secFetchSite?.trim().toLowerCase();
  if (site && site !== "same-origin" && site !== "none") return true;

  if (input.origin === null) return false;
  let origin: URL;
  try {
    origin = new URL(input.origin);
  } catch {
    return true; // « null » (contexte opaque) ou valeur illisible
  }
  const candidates = [input.host];
  if (input.trustProxy && input.forwardedHost) {
    // Valeur la plus à droite : celle ajoutée par notre proxy (comme pour X-Forwarded-For).
    candidates.push(input.forwardedHost.split(",").at(-1) ?? null);
  }
  return !candidates.some((h) => h && normalizeHost(h, origin.protocol) === origin.host);
}
