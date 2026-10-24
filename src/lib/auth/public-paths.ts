const PUBLIC_EXACT = new Set([
  "/login",
  "/api/auth/login",
  "/api/health",
  "/favicon.ico",
  "/robots.txt",
  "/icon.svg",
  "/apple-icon.png",
  "/manifest.webmanifest",
]);

/** Chemins accessibles sans session (liste blanche explicite, pas de règle par extension). */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_EXACT.has(pathname) || pathname.startsWith("/_next/");
}
