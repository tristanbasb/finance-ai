# Finance AI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Outil de finances perso auto-hébergé (dépenses, épargne, investissements) avec assistant IA Claude, livré en repo public avec `install.sh` / `update.sh`.

**Architecture:** Une app Next.js (App Router) qui sert UI + API, données dans un fichier SQLite via Drizzle, migrations au démarrage (`instrumentation.ts`). Logique métier pure dans `src/lib/*` (testée vitest), accès DB dans `src/lib/queries/*`, routes API minces. Un seul conteneur Docker.

**Tech Stack:** Next.js 15, React 19, TypeScript strict, Tailwind CSS v4, recharts, lucide-react, better-sqlite3, drizzle-orm + drizzle-kit, zod, jose, @anthropic-ai/sdk, yahoo-finance2, vitest.

**Spec:** `docs/superpowers/specs/2026-10-24-finance-ai-design.md`

## Global Constraints

- UI 100 % français, devise € formatée `Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })`.
- Montants en base = centimes entiers signés (dépense < 0, revenu > 0). Quantités = réels.
- Dates en base = chaîne `YYYY-MM-DD`.
- `.env` jamais commité ; `.env.example` documente : `APP_PASSWORD_HASH`, `SESSION_SECRET`, `ANTHROPIC_API_KEY`, `CLAUDE_MODEL=claude-opus-5-5`, `APP_PORT=3000`, `COOKIE_SECURE=auto`.
- Hash mot de passe : `scrypt:<sel hex>:<hash hex>` (aucun `$`).
- Toutes les routes protégées sauf `/login`, `/api/auth/login`, `/api/health`, assets `_next`.
- Erreurs API : JSON `{ error: string }` + code HTTP (400 validation, 401, 404, 409, 429, 503 IA absente).
- L'IA est en lecture seule sur les données.
- Scripts shell : bash, `set -euo pipefail`, fins de ligne LF, compatibles Debian/Ubuntu.
- Commits : messages conventionnels en français, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **CSV bancaires français réels** (BOM UTF-8, `;`, montants `-1 234,56 €`, dates `24/10/2026`, champs entre guillemets contenant `;`, lignes vides, colonnes Débit/Crédit séparées) → parsés correctement ; lignes invalides listées, jamais de crash. Tests dans Task 2.
2. **Accès en HTTP simple sur IP:port** (pas encore de reverse proxy) → le cookie ne doit pas être `Secure` sinon boucle de login. `COOKIE_SECURE=auto` = Secure seulement si `x-forwarded-proto`/protocole est `https`. Test dans Task 4.
3. **Source de cours indisponible ou symbole inconnu** → dernier cours connu, sinon PRU ; la page Investissements s'affiche quand même. Tests dans Task 7.
4. **Clé Anthropic absente ou invalide** → 503 explicite, UI IA grisée avec message, reste de l'app intact. Test dans Task 12.
5. **Suppression d'un élément référencé** → supprimer une catégorie met `category_id` à NULL sur ses transactions ; supprimer un compte ayant des transactions/positions renvoie 409 « archivez-le plutôt ». Test dans Task 6.

---

## File Structure

```
package.json  tsconfig.json  next.config.ts  postcss.config.mjs  vitest.config.ts  drizzle.config.ts
Dockerfile  docker-compose.yml  .dockerignore  .env.example  .gitignore  LICENSE  README.md
install.sh  update.sh  scripts/{lib.sh,set-password.sh,hash-password.mjs}
.github/workflows/ci.yml
drizzle/                      # migrations générées par drizzle-kit
src/instrumentation.ts        # migrate + seed au boot (runtime nodejs)
src/middleware.ts             # garde d'auth
src/lib/money.ts              # format/parse montants FR, centimes
src/lib/csv.ts                # parse CSV + détection + mapping
src/lib/finance.ts            # calculs purs
src/lib/validation.ts         # schémas zod partagés
src/lib/auth/{password,session,rate-limit}.ts
src/lib/db/{schema,index,migrate,seed}.ts
src/lib/queries/{accounts,categories,transactions,goals,holdings,overview,snapshots}.ts
src/lib/prices/{yahoo,coingecko,index}.ts
src/lib/ai/{client,tools,chat,categorize,insights}.ts
src/app/layout.tsx  src/app/globals.css  src/app/login/page.tsx
src/app/(app)/layout.tsx  + page.tsx, transactions/, savings/, investments/, assistant/, settings/
src/app/api/...               # voir Task 6, 7, 12
src/components/ui/*           # button, card, input, select, dialog, badge, progress, toast
src/components/*              # sidebar, charts, formulaires
tests/*.test.ts
```

---

### Task 1: Scaffold + outillage + CI

**Files:** Create les fichiers racine ci-dessus (sauf scripts/Docker), `src/app/layout.tsx`, `src/app/globals.css`, `src/app/api/health/route.ts`, `.github/workflows/ci.yml`, `tests/smoke.test.ts`.

**Interfaces:** Produces: `GET /api/health` → `200 { status: "ok" }` ; scripts npm `dev`, `build`, `start`, `test`, `lint`, `typecheck`, `db:generate`.

- [ ] Step 1: `package.json` avec dépendances du Tech Stack ; `next.config.ts` avec `output: 'standalone'`, `serverExternalPackages: ['better-sqlite3']`.
- [ ] Step 2: `tests/smoke.test.ts` : `expect(1 + 1).toBe(2)` ; `npm test` → PASS.
- [ ] Step 3: Route health ; `npm run build` → succès.
- [ ] Step 4: CI GitHub Actions (Node 22) : `npm ci && npm run typecheck && npm test && npm run build`.
- [ ] Step 5: Commit `chore: initialise le projet Next.js`.

### Task 2: Montants et CSV

**Files:** Create `src/lib/money.ts`, `src/lib/csv.ts`, `tests/money.test.ts`, `tests/csv.test.ts`.

**Interfaces:** Produces:
- `formatEUR(cents: number): string`, `parseAmount(raw: string): number | null` (→ centimes), `toCents(euros: number): number`, `fromCents(cents: number): number`.
- `parseDate(raw: string): string | null` (→ `YYYY-MM-DD`, accepte `DD/MM/YYYY`, `DD-MM-YYYY`, `DD.MM.YYYY`, `YYYY-MM-DD`, `DD/MM/YY`).
- `parseCsv(text: string): { headers: string[]; rows: string[][]; delimiter: ';' | ',' | '\t' }`.
- `type CsvMapping = { date: number; label: number; amount?: number; debit?: number; credit?: number }`.
- `guessMapping(headers: string[]): Partial<CsvMapping>` (mots-clés : date, libellé/label/description, montant/amount, débit, crédit).
- `mapRows(rows: string[][], m: CsvMapping): { valid: ParsedTx[]; errors: { line: number; reason: string }[] }` avec `ParsedTx = { date: string; label: string; amount: number }`.

- [ ] Step 1: Tests :
  - `parseAmount('-1 234,56 €') === -123456`, `parseAmount('1,234.56') === 123456`, `parseAmount('12') === 1200`, `parseAmount('+3,5') === 350`, `parseAmount('abc') === null`, espace insécable `'1 000,00'` → `100000`.
  - `parseDate('24/10/2026') === '2026-10-24'`, `parseDate('2026-10-24')`, `parseDate('24/10/26') === '2026-10-24'`, `parseDate('31/02/2026') === null`.
  - `parseCsv` : BOM retiré ; délimiteur `;` détecté ; `"Achat; cadeau"` reste un seul champ ; lignes vides ignorées.
  - `mapRows` avec colonnes Débit/Crédit : débit `12,50` → `-1250`, crédit `100` → `10000` ; ligne avec date invalide → dans `errors` avec son numéro de ligne.
  - `formatEUR(-123456)` contient `1 234,56` et `€` (comparer après normalisation des espaces fines).
- [ ] Step 2: `npx vitest run tests/money.test.ts tests/csv.test.ts` → FAIL.
- [ ] Step 3: Implémenter (parser CSV maison à états, gestion guillemets doublés ; détection du délimiteur = le plus fréquent hors guillemets sur la 1re ligne).
- [ ] Step 4: Tests → PASS.
- [ ] Step 5: Commit `feat: parsing des montants, dates et CSV bancaires`.

### Task 3: Calculs financiers purs

**Files:** Create `src/lib/finance.ts`, `tests/finance.test.ts`.

**Interfaces:** Produces:
- `accountBalance(initial: number, txAmounts: number[]): number`
- `holdingValue(h: { quantity: number; price: number }): number` (centimes, arrondi)
- `holdingPnl(h: { quantity: number; avgPrice: number; price: number }): { value: number; cost: number; pnl: number; pnlPct: number }` (prix en centimes ; `pnlPct` = 0 si coût 0)
- `savingsRate(income: number, expenses: number): number` (expenses négatif ; `(income + expenses) / income`, 0 si income ≤ 0)
- `goalProgress(g: { target: number; current: number; deadline: string | null }, today: string): { pct: number; remaining: number; monthlyNeeded: number | null }` (pct borné 0–1 ; `monthlyNeeded` = remaining / mois restants arrondis au supérieur, min 1 ; null si pas d'échéance ; 0 si atteint)
- `budgetStatus(spent: number, budget: number | null): { pct: number; level: 'ok' | 'warn' | 'over' } | null` (warn ≥ 0.8, over > 1)
- `monthRange(month: string): { start: string; end: string }` (`'2026-02'` → `2026-02-01`, `2026-02-28`)

- [ ] Step 1: Tests avec valeurs : `holdingPnl({quantity: 2, avgPrice: 10000, price: 12500})` → `{value: 25000, cost: 20000, pnl: 5000, pnlPct: 0.25}` ; `savingsRate(300000, -210000) === 0.3` ; `goalProgress({target: 100000, current: 40000, deadline: '2027-04-24'}, '2026-10-24').monthlyNeeded === 10000` ; `budgetStatus(8500, 10000).level === 'warn'` ; `monthRange('2028-02').end === '2028-02-29'`.
- [ ] Step 2: FAIL → Step 3: implémenter → Step 4: PASS.
- [ ] Step 5: Commit `feat: calculs financiers (soldes, plus-values, épargne, objectifs)`.

### Task 4: Authentification

**Files:** Create `src/lib/auth/password.ts`, `src/lib/auth/session.ts`, `src/lib/auth/rate-limit.ts`, `src/middleware.ts`, `src/app/login/page.tsx`, `src/app/api/auth/login/route.ts`, `src/app/api/auth/logout/route.ts`, `scripts/hash-password.mjs`, `tests/auth.test.ts`.

**Interfaces:** Produces:
- `hashPassword(pw: string): Promise<string>` / `verifyPassword(pw: string, stored: string): Promise<boolean>` (scrypt N=16384, keylen 64, `timingSafeEqual`).
- `createSession(): Promise<string>` / `verifySession(token: string | undefined): Promise<boolean>` (JWT HS256, 30 jours, secret `SESSION_SECRET`). Cookie `fa_session`.
- `shouldUseSecureCookie(setting: string | undefined, proto: string | null): boolean` (`'true'`→true, `'false'`→false, `auto`/absent → `proto === 'https'`).
- `createRateLimiter(max: number, windowMs: number): { hit(key: string, now?: number): boolean }` (true = autorisé).
- `scripts/hash-password.mjs` : lit le mot de passe sur stdin, imprime le hash (même algo que `hashPassword`, dupliqué en JS pur sans import TS).

- [ ] Step 1: Tests : hash puis verify OK / mauvais mot de passe KO / hash ne contient pas `$` ; session valide puis token altéré → false ; `shouldUseSecureCookie('auto', 'http') === false`, `('auto','https') === true` ; rate limiter : 5 hits OK, 6e refusé, autorisé de nouveau après la fenêtre.
- [ ] Step 2: FAIL → Step 3: implémenter. Middleware : redirige vers `/login` (pages) ou 401 JSON (`/api/*`). Login : limite 5 / 15 min par IP (`x-forwarded-for` 1re valeur) → 429.
- [ ] Step 4: PASS ; `npm run build` OK.
- [ ] Step 5: Commit `feat: authentification par mot de passe et sessions`.

### Task 5: Base de données

**Files:** Create `src/lib/db/schema.ts`, `src/lib/db/index.ts`, `src/lib/db/migrate.ts`, `src/lib/db/seed.ts`, `src/instrumentation.ts`, `drizzle.config.ts`, `drizzle/*` (généré), `tests/db.test.ts`.

**Interfaces:** Produces: tables Drizzle `accounts`, `categories`, `transactions`, `goals`, `holdings`, `prices`, `snapshots`, `aiCache` (colonnes exactes de la spec §3, FK `transactions.category_id` ON DELETE SET NULL) ; `getDb(): BetterSQLite3Database` (singleton, chemin `process.env.DATABASE_PATH ?? './data/finance.db'`, crée le dossier, `journal_mode=WAL`, `foreign_keys=ON`) ; `runMigrations(db)` ; `seedDefaults(db)` (idempotent : catégories par défaut de la spec + un compte « Compte courant » si aucun compte).

- [ ] Step 1: Test avec `DATABASE_PATH=':memory:'` : migrations + seed deux fois → 12 catégories, 1 compte ; suppression d'une catégorie → transaction garde `category_id = null`.
- [ ] Step 2: FAIL → Step 3: schéma, `npm run db:generate`, implémenter ; `instrumentation.ts` appelle migrate + seed si `NEXT_RUNTIME === 'nodejs'`.
- [ ] Step 4: PASS.
- [ ] Step 5: Commit `feat: schéma SQLite, migrations et données par défaut`.

### Task 6: Requêtes et API CRUD

**Files:** Create `src/lib/validation.ts`, `src/lib/queries/{accounts,categories,transactions,goals,holdings,overview}.ts`, routes `src/app/api/{accounts,categories,transactions,goals,holdings}/route.ts` (GET, POST) et `[id]/route.ts` (PATCH, DELETE), `src/app/api/transactions/import/route.ts`, `src/app/api/export/route.ts`, `tests/queries.test.ts`.

**Interfaces:** Produces (toutes prennent `db` en 1er paramètre pour la testabilité) :
- `listAccountsWithBalances(db): AccountWithBalance[]` (`balance`, `investmentsValue`, `total`)
- `listTransactions(db, f: { month?: string; accountId?: number; categoryId?: number; q?: string; limit?: number })`
- `createTransactions(db, txs: NewTransaction[]): number` (insertion en transaction SQL)
- `spendingByCategory(db, start: string, end: string): { categoryId: number | null; name: string; color: string; total: number }[]`
- `monthTotals(db, month: string): { income: number; expenses: number }`
- `getOverview(db, today: string): Overview` (`netWorth`, `cash`, `investments`, `month` totaux, `savingsRate`, `budgets[]`, `recent[]`)
- `deleteAccount(db, id)` → lève `ConflictError` si transactions/positions liées.
- Schémas zod : `accountInput`, `categoryInput`, `transactionInput` (montant en centimes entier), `goalInput`, `holdingInput`, `importInput = { accountId, rows: ParsedTx[] & { categoryId? } }`.
- `GET /api/export` → JSON de toutes les tables, `Content-Disposition: attachment`.

- [ ] Step 1: Tests (DB mémoire) : solde = initial + transactions ; `spendingByCategory` n'inclut que les montants < 0 de la période ; `getOverview` patrimoine = cash + investissements ; `deleteAccount` avec transactions → `ConflictError` ; zod rejette montant non entier.
- [ ] Step 2: FAIL → Step 3: implémenter ; routes : `ConflictError` → 409 `{ error: "Ce compte contient des données, archivez-le plutôt." }`.
- [ ] Step 4: PASS.
- [ ] Step 5: Commit `feat: requêtes et API CRUD`.

### Task 7: Cours des actifs

**Files:** Create `src/lib/prices/{yahoo,coingecko,index}.ts`, `src/lib/queries/snapshots.ts`, `src/app/api/prices/refresh/route.ts`, `tests/prices.test.ts`.

**Interfaces:** Produces:
- `type PriceFetcher = (symbols: string[]) => Promise<Map<string, { price: number; currency: string }>>` (prix en unités, pas centimes).
- `refreshPrices(db, deps: { stock: PriceFetcher; crypto: PriceFetcher; fx: (cur: string) => Promise<number> }, now: Date, force?: boolean): Promise<{ updated: number; failed: string[] }>` — ignore les cours < 15 min sauf `force` ; convertit en EUR ; enregistre en centimes.
- `resolvePrice(db, h: Holding): { price: number; source: 'live' | 'cache' | 'manual' | 'cost' }` (manual → `manual_price`, sinon `prices`, sinon `avg_price`).
- `recordSnapshot(db, today: string)` (upsert sur la date).
- `POST /api/prices/refresh` → appelle `refreshPrices` avec les fetchers réels puis `recordSnapshot`.

- [ ] Step 1: Tests avec fetchers simulés : USD converti (`1.1` → prix EUR = prix / 1.1) ; fetcher qui lève → symbole dans `failed`, ancien cours conservé ; aucun cours → `resolvePrice` source `'cost'` ; cours frais non re-demandé sans `force`.
- [ ] Step 2: FAIL → Step 3: implémenter (Yahoo via `yahoo-finance2` `quote`, CoinGecko `/api/v3/search?query=` puis `/simple/price?ids=&vs_currencies=eur`, timeout 8 s via `AbortSignal.timeout`).
- [ ] Step 4: PASS.
- [ ] Step 5: Commit `feat: actualisation des cours et snapshots du patrimoine`.

### Task 8: Système de design + coque + tableau de bord

**Files:** Create `src/components/ui/*`, `src/components/sidebar.tsx`, `src/components/charts/{net-worth-chart,category-donut}.tsx`, `src/app/(app)/layout.tsx`, `src/app/(app)/page.tsx`, `src/components/ai-insights-card.tsx`.

**Interfaces:** Consumes `getOverview`, `spendingByCategory`, `recordSnapshot`, `listSnapshots(db, days)`. Produces composants UI réutilisés par Tasks 9–12 : `Button`, `Card`, `Input`, `Select`, `Dialog`, `Badge`, `Progress`, `toast()`.

- [ ] Step 1: Charger le skill `frontend-design`. Direction : sobre « fintech », typographie Inter/Geist, tokens CSS (clair/sombre via `prefers-color-scheme`), chiffres tabulaires, accent unique, cartes à bordure fine.
- [ ] Step 2: Sidebar (desktop) / barre d'onglets en bas (mobile) : Tableau de bord, Transactions, Épargne, Investissements, Assistant, Réglages, Déconnexion.
- [ ] Step 3: Dashboard (Server Component) : KPIs, courbe, donut, budgets (`budgetStatus`), récents, carte IA (client, appelle `/api/ai/insights`, masquée si IA désactivée).
- [ ] Step 4: Vérifier dans le navigateur (`npm run dev`) desktop + 375 px, clair + sombre.
- [ ] Step 5: Commit `feat: interface et tableau de bord`.

### Task 9: Transactions + import CSV

**Files:** Create `src/app/(app)/transactions/page.tsx`, `src/components/transactions/{transaction-list,transaction-dialog,import-wizard,filters}.tsx`.

**Interfaces:** Consumes API Task 6, `parseCsv`/`guessMapping`/`mapRows` (côté client), `POST /api/ai/categorize` (Task 12, bouton désactivé si IA off).

- [ ] Step 1: Liste groupée par jour avec filtres (mois, compte, catégorie, recherche) dans l'URL.
- [ ] Step 2: Dialogue ajout/édition : type dépense/revenu (signe automatique), montant FR, date, compte, catégorie, note ; raccourci `N`.
- [ ] Step 3: Assistant d'import : fichier → mapping (pré-rempli par `guessMapping`) → aperçu avec erreurs → « Catégoriser avec l'IA » → choix du compte → import.
- [ ] Step 4: Vérifier avec un CSV d'exemple `tests/fixtures/releve.csv` (format Débit/Crédit, `;`).
- [ ] Step 5: Commit `feat: page transactions et import CSV`.

### Task 10: Épargne + Investissements

**Files:** Create `src/app/(app)/savings/page.tsx`, `src/app/(app)/investments/page.tsx`, `src/components/savings/goal-dialog.tsx`, `src/components/investments/{holding-dialog,holdings-table,allocation-chart}.tsx`.

**Interfaces:** Consumes `goalProgress`, `holdingPnl`, `resolvePrice`, API goals/holdings, `POST /api/prices/refresh`.

- [ ] Step 1: Épargne : cartes comptes épargne + objectifs (progression, « X €/mois pour atteindre l'objectif »).
- [ ] Step 2: Investissements : tableau positions (cours + badge source, valeur, +/- € et %, coloré), totaux, donut par type, bouton actualiser (toast avec `failed`).
- [ ] Step 3: Vérifier dans le navigateur.
- [ ] Step 4: Commit `feat: pages épargne et investissements`.

### Task 11: Réglages

**Files:** Create `src/app/(app)/settings/page.tsx`, `src/components/settings/{accounts-manager,categories-manager,ai-status}.tsx`.

- [ ] Step 1: CRUD comptes (archivage ; 409 affiché en toast), catégories (couleur, budget), bouton export JSON, statut IA (modèle, clé présente oui/non — jamais la clé).
- [ ] Step 2: Vérifier ; Commit `feat: page réglages`.

### Task 12: IA Claude

**Files:** Create `src/lib/ai/{client,tools,chat,categorize,insights}.ts`, `src/app/api/ai/{chat,categorize,insights,status}/route.ts`, `src/app/(app)/assistant/page.tsx`, `src/components/assistant/chat.tsx`, `tests/ai.test.ts`.

**Interfaces:** Produces:
- `getAi(): { client: Anthropic; model: string } | null` (null si pas de clé).
- `aiTools: Anthropic.Tool[]` + `runTool(db, name: string, input: unknown): Promise<unknown>` pour `get_overview`, `search_transactions`, `spending_by_category`, `get_holdings`, `get_goals` (montants renvoyés en euros, pas centimes).
- `POST /api/ai/chat` body `{ messages: {role, content}[] }` → flux SSE d'événements `{ type: 'text', text } | { type: 'tool', name } | { type: 'done' } | { type: 'error', error }` ; boucle outils max 8 tours.
- `categorize(labels: string[], categories: {id, name, kind}[]): Promise<(number | null)[]>` (sortie structurée JSON schema, ids hors liste → null).
- `getInsights(db, month: string, refresh: boolean): Promise<string[]>` (cache `ai_cache` clé `insights:<month>`).
- `GET /api/ai/status` → `{ enabled: boolean; model: string }`.

- [ ] Step 1: Charger le skill `claude-api` (vérifier API streaming, tool use, structured outputs, id modèle).
- [ ] Step 2: Tests : `getAi()` null sans clé et routes → 503 `{ error: "Assistant IA désactivé : ajoutez ANTHROPIC_API_KEY dans .env" }` ; `runTool('search_transactions', {q: 'loyer'})` filtre correctement (DB mémoire) ; `runTool` nom inconnu → `{ error }` ; `categorize` mappe un id invalide → null (client simulé).
- [ ] Step 3: FAIL → Step 4: implémenter. Prompt système en français : rôle d'assistant financier perso, date du jour, devise €, utilise les outils plutôt que d'inventer, concis, pas un conseil agréé.
- [ ] Step 5: Page assistant : bulles, markdown léger, suggestions de questions, indicateur d'outil en cours, disclaimer, état désactivé.
- [ ] Step 6: PASS + test manuel avec clé réelle si disponible.
- [ ] Step 7: Commit `feat: assistant IA Claude (chat, catégorisation, analyses)`.

### Task 13: Docker, scripts d'installation, documentation

**Files:** Create `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.env.example`, `install.sh`, `update.sh`, `scripts/lib.sh`, `scripts/set-password.sh`, `README.md`, `LICENSE`.

**Interfaces:** Consumes `scripts/hash-password.mjs`, `/api/health`.

- [ ] Step 1: Dockerfile multi-stage (`node:22-bookworm-slim` pour build natif de better-sqlite3 ; runtime copie `.next/standalone`, `.next/static`, `public`, `drizzle`, `scripts/hash-password.mjs`), utilisateur non-root, `DATABASE_PATH=/app/data/finance.db`.
- [ ] Step 2: compose : service `app`, `env_file: .env`, port `${APP_PORT:-3000}:3000`, volume `./data:/app/data`, `restart: unless-stopped`, healthcheck `node -e "fetch('http://localhost:3000/api/health')..."`.
- [ ] Step 3: `install.sh` selon spec §8 (fonctions communes dans `scripts/lib.sh` : couleurs, `confirm`, `wait_healthy`, `compose` = `docker compose` ou `docker-compose`) ; mot de passe lu avec `read -s` deux fois ; `chown` du dossier `data` vers l'UID du conteneur (1001).
- [ ] Step 4: `update.sh` selon spec §8 ; `set-password.sh` remplace `APP_PASSWORD_HASH` dans `.env` puis redémarre.
- [ ] Step 5: `bash -n` + `shellcheck` (via conteneur `koalaman/shellcheck`) sur tous les scripts → aucune erreur.
- [ ] Step 6: README FR : captures/description, prérequis, installation en une ligne, mise à jour, reverse proxy Caddy exemple, sauvegarde/restauration, confidentialité IA, développement local.
- [ ] Step 7: Commit `feat: Docker, install.sh et update.sh`.

### Task 14: Vérification de bout en bout + publication

- [ ] Step 1: `npm run typecheck && npm test && npm run build` → tout vert.
- [ ] Step 2: `docker compose build` puis lancer avec un `.env` de test ; `curl /api/health` → `ok` ; connexion via navigateur, créer compte/transaction/position, import CSV fixture.
- [ ] Step 3: Simuler `update.sh` (sauvegarde créée, app redémarre, données présentes).
- [ ] Step 4: `gh repo create tristanbasb/finance-ai --public --source . --push` ; vérifier que `.env`, `data/`, `backups/` ne sont pas poussés.
- [ ] Step 5: Vérifier la CI GitHub verte.
