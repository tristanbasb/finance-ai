// Protection CSRF des routes /api : refus des requêtes modifiantes venant d'un autre site.

export type CsrfInput = {
  method: string;
  pathname: string;
  /** En-tête Host de la requête. */
  host: string | null;
  origin: string | null;
  secFetchSite: string | null;
  /** En-tête X-Forwarded-Host (ajouté par un reverse proxy). */
  forwardedHost: string | null;
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
 * Vrai si la requête doit être refusée (méthode modifiante vers /api) :
 * - `Sec-Fetch-Site` présent : seuls `same-origin` et `none` passent (en-tête qu'un site tiers
 *   ne peut pas forger ; aucune comparaison Origin/Host, qu'un reverse proxy peut réécrire) ;
 * - sinon, `Origin` présent : son hôte doit égaler `X-Forwarded-Host` (1re valeur) s'il existe,
 *   sinon `Host` (une requête cross-site ne peut pas ajouter cet en-tête sans préflight CORS,
 *   refusé) ;
 * - ni l'un ni l'autre (curl, scripts) : la requête passe.
 */
export function isCrossSiteRequest(input: CsrfInput): boolean {
  if (SAFE_METHODS.has(input.method.toUpperCase())) return false;
  if (input.pathname !== "/api" && !input.pathname.startsWith("/api/")) return false;

  const site = input.secFetchSite?.trim().toLowerCase();
  if (site) return site !== "same-origin" && site !== "none";

  if (input.origin === null) return false;
  let origin: URL;
  try {
    origin = new URL(input.origin);
  } catch {
    return true; // « null » (contexte opaque) ou valeur illisible
  }
  const forwarded = input.forwardedHost?.split(",")[0]?.trim();
  const expected = forwarded || input.host;
  return !expected || normalizeHost(expected, origin.protocol) !== origin.host;
}
