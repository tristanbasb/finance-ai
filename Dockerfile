# syntax=docker/dockerfile:1

# ---- Dépendances (dev incluses, nécessaires au build) ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# better-sqlite3 embarque ses binaires précompilés (prebuilds/linux-x64, linux-arm64…), mais
# npm 10 lance quand même `node-gyp rebuild` (binding.gyp présent) et échouerait sans Python.
# Aucun paquet nécessaire au build n'a de script d'installation utile : on les ignore.
RUN npm ci --no-audit --no-fund --ignore-scripts

# ---- Build Next.js (sortie standalone) ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- Image d'exécution ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# TZ : fuseau des dates « du jour » (mois en cours, instantanés) ; modifiable via TZ= dans .env.
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_PATH=/app/data/finance.db \
    NEXT_TELEMETRY_DISABLED=1 \
    TZ=Europe/Paris

# Utilisateur non-root (UID/GID 1001 : install.sh donne ./data et ./backups à cet UID).
RUN groupadd --system --gid 1001 app \
 && useradd --system --uid 1001 --gid app --no-create-home --shell /usr/sbin/nologin app

# Le code appartient à root (lecture seule pour l'app) ; seuls data/, backups/ et le cache sont modifiables.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts/hash-password.mjs /app/scripts/backup-db.mjs ./scripts/

# Vérifie dès le build que le binaire natif de better-sqlite3 (tracé par Next.js) se charge.
RUN node -e "new (require('better-sqlite3'))(':memory:').close(); console.log('better-sqlite3 OK')"

RUN mkdir -p /app/data /app/backups /app/.next/cache \
 && chown app:app /app/data /app/backups /app/.next/cache

USER app
EXPOSE 3000
CMD ["node", "server.js"]
