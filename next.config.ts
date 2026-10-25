import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  poweredByHeader: false,
  experimental: {
    // Le cache Turbopack du build (.next/cache) n'est jamais réutilisé dans Docker, et son
    // écriture prenait plusieurs minutes sur un petit VPS après la liste des routes.
    turbopackFileSystemCacheForBuild: false,
  },
  typescript: {
    // Le Dockerfile saute la vérification des types (≈ 3 min sur un petit VPS) : la CI la fait
    // déjà à chaque push. Partout ailleurs (`npm run build` en local), elle reste active.
    ignoreBuildErrors: process.env.FINANCE_AI_SKIP_TYPECHECK === "1",
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
