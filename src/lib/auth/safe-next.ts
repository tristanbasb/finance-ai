// Caractères de contrôle et antislash : les navigateurs les retirent/normalisent (`/\evil.com`,
// `/<tab>/evil.com` deviennent `//evil.com`), ce qui contourne un simple test de préfixe.
const FORBIDDEN = /[\\\x00-\x1f\x7f]/;

/** Retourne un chemin interne sûr pour la redirection après connexion, sinon `/`. */
export function safeNext(next: string | null, origin: string): string {
  if (!next || FORBIDDEN.test(next)) return "/";
  try {
    const url = new URL(next, origin);
    if (url.origin !== origin) return "/";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/";
  }
}
