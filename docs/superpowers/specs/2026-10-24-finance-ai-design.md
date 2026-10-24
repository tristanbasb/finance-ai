# Finance AI — Spécification de conception

> **Écarts de l'implémentation (v1).** Cette spécification est conservée telle qu'approuvée ;
> le code s'en écarte sur ces points :
>
> - **Next.js 16** (et non 15) : le middleware d'authentification s'appelle désormais
>   `src/proxy.ts` (convention « proxy » de Next.js 16).
> - Image Docker basée sur **`node:22-bookworm-slim`** (et non Alpine) : binaires précompilés
>   de better-sqlite3 (glibc), sans chaîne de compilation.
> - **Prix unitaires** des positions (`avg_price`, `manual_price`, cours en cache) stockés en
>   **centimes réels (REAL)** pour garder la précision des cours fractionnaires ; les montants
>   (transactions, soldes, totaux) restent en centimes entiers.

Date : 2026-10-24
Statut : approuvée (conversation), en revue écrite

## 1. Objectif

Un outil de finances personnelles **ultra moderne et simple**, auto-hébergé sur un
VPS/serveur Linux, pour suivre :

- les **dépenses** (et revenus),
- l'**épargne** (comptes + objectifs),
- les **investissements** (actions, ETF, cryptos avec cours automatiques ; actifs manuels).

Une IA basée sur l'**API Claude** aide à analyser, catégoriser et discuter des finances.

Livré comme **repo GitHub public** `tristanbasb/finance-ai` (licence MIT) avec
`install.sh` et `update.sh`.

### Critères de réussite

1. Sur un serveur Linux vierge : `git clone … && ./install.sh` → application en ligne,
   protégée par mot de passe, en moins de 5 minutes (hors temps de build).
2. `./update.sh` met à jour vers la dernière version **sans perte de données**
   (sauvegarde automatique avant mise à jour).
3. L'app fonctionne sans clé API Claude (fonctions IA désactivées proprement).
4. Interface en français, devise €, responsive mobile, thème clair/sombre.

### Hypothèses

- Mono-utilisateur, pas de multi-comptes.
- Saisie manuelle + import CSV de relevés ; pas d'agrégation bancaire directe.
- La clé API vit dans `.env` (jamais commitée).

## 2. Architecture

- **Next.js 15** (App Router, TypeScript strict), Server Components + Route Handlers.
- **SQLite** (`better-sqlite3`) + **Drizzle ORM**. Fichier `data/finance.db`.
  Migrations appliquées automatiquement au démarrage du serveur.
- **UI** : Tailwind CSS v4, composants maison style shadcn/ui, icônes `lucide-react`,
  graphiques `recharts`.
- **Auth** : mot de passe unique. Hash scrypt (crypto Node natif, format `scrypt:<sel hex>:<hash hex>`, sans `$` pour éviter l’interpolation docker compose) stocké dans `.env` (`APP_PASSWORD_HASH`),
  session = JWT signé (`jose`, secret `SESSION_SECRET`) en cookie httpOnly, SameSite=Lax,
  `Secure` si HTTPS. Middleware protégeant toutes les routes sauf `/login` et
  `/api/health`. Limitation des tentatives de connexion en mémoire (5 / 15 min / IP).
- **Déploiement** : image Docker multi-stage (Node 22 alpine, sortie `standalone`),
  `docker-compose.yml` avec volume `./data:/app/data`, port `APP_PORT` (défaut 3000),
  healthcheck sur `/api/health`.

## 3. Modèle de données

| Table | Colonnes principales |
|---|---|
| `accounts` | id, name, type (`checking`/`savings`/`investment`/`crypto`/`other`), initial_balance, color, archived, created_at |
| `categories` | id, name, kind (`expense`/`income`), color, icon, monthly_budget (nullable) |
| `transactions` | id, account_id, category_id (nullable), date (YYYY-MM-DD), amount (centimes, signé), label, note, created_at |
| `goals` | id, name, target_amount, account_id (nullable), current_amount (si pas de compte), deadline (nullable), color |
| `holdings` | id, account_id, symbol, name, asset_type (`stock`/`etf`/`crypto`/`manual`), quantity, avg_price, manual_price (nullable), currency |
| `prices` | symbol, price, currency, fetched_at |
| `snapshots` | date (PK), net_worth, cash, investments |
| `ai_cache` | key (PK), value, created_at |

Montants stockés en **centimes (entiers)** pour éviter les erreurs d'arrondi ; quantités en réel.

Solde d'un compte = `initial_balance + Σ transactions.amount`.
Valeur d'un compte investissement = solde espèces + Σ (quantité × cours) des positions.
Patrimoine net = Σ valeurs de tous les comptes non archivés.

Catégories par défaut créées au premier démarrage (Alimentation, Logement, Transport,
Loisirs, Santé, Abonnements, Shopping, Restaurants, Voyages, Autres ; Salaire,
Autres revenus).

## 4. Écrans

1. **Tableau de bord** : patrimoine net + courbe d'évolution (snapshots), dépenses du mois
   vs budgets, revenus/dépenses du mois, taux d'épargne, donut des dépenses par catégorie,
   5 dernières transactions, carte « Analyse IA » du mois.
2. **Transactions** : liste filtrable (mois, compte, catégorie, recherche), ajout/édition
   rapide en dialogue, suppression, **import CSV** (détection séparateur `;`/`,`,
   formats de date FR/ISO, montants FR `1 234,56`), mapping des colonnes, aperçu,
   catégorisation IA optionnelle avant enregistrement.
3. **Épargne** : comptes d'épargne avec soldes, objectifs avec progression et
   montant mensuel nécessaire pour atteindre l'échéance.
4. **Investissements** : positions par compte, cours, valeur, plus/moins-value € et %,
   répartition par type, bouton « Actualiser les cours ».
5. **Assistant** : chat streaming avec Claude, outils en lecture seule sur la base.
6. **Réglages** : comptes (CRUD, archivage), catégories (CRUD, budget), export JSON
   complet, statut de l'IA (modèle, clé présente).

## 5. IA (API Claude)

- SDK officiel `@anthropic-ai/sdk`. Modèle via `CLAUDE_MODEL` (défaut : `claude-opus-5-5`).
- **Chat** (`/api/ai/chat`) : streaming SSE, boucle d'outils côté serveur. Outils :
  `get_overview` (soldes, patrimoine, mois en cours), `search_transactions`
  (filtres date/catégorie/texte/montant), `spending_by_category` (période),
  `get_holdings`, `get_goals`. Lecture seule — l'IA ne modifie jamais les données.
- **Catégorisation** (`/api/ai/categorize`) : lot de libellés → id de catégorie via
  sortie structurée (JSON schema).
- **Analyse du mois** (`/api/ai/insights`) : 3–5 observations et conseils concis,
  mis en cache par mois dans `ai_cache` (régénérable manuellement).
- Sans `ANTHROPIC_API_KEY` : endpoints renvoient 503 explicite, l'UI masque/grise les
  fonctions IA.
- Avertissement dans le README : les données consultées sont envoyées à l'API Anthropic.
- Disclaimer dans l'assistant : informations générales, pas un conseil financier agréé.

## 6. Cours des actifs

- Actions/ETF : `yahoo-finance2` (`quote`). Cryptos : API publique CoinGecko
  (`/simple/price`, symbole → id via `/search`).
- Conversion en EUR si devise différente (taux via Yahoo `EURUSD=X` etc.).
- Cache 15 min dans `prices` ; en cas d'échec, dernier cours connu ; sinon PRU.
- Actifs `manual` : `manual_price` saisi par l'utilisateur.
- Snapshot du patrimoine enregistré au plus une fois par jour (à la première consultation
  du tableau de bord ou après actualisation des cours).

## 7. Robustesse & tests

- Validation `zod` de toutes les entrées API.
- Erreurs API renvoyées en JSON `{ error }` avec code HTTP adapté ; toasts côté UI.
- **vitest** sur la logique pure : calculs (soldes, patrimoine, plus-values, taux
  d'épargne, progression objectifs), parsing CSV/dates/montants FR, rate limiter.
- `npm run build` + `npm test` en CI (GitHub Actions).

## 8. Scripts

### `install.sh`
1. Vérifie Linux + droits (sudo si nécessaire).
2. Vérifie `git`, Docker et `docker compose` ; propose d'installer Docker via le
   script officiel `get.docker.com` (confirmation demandée).
3. Si lancé hors du repo (via curl), clone le repo dans `~/finance-ai`.
4. Build l’image, puis crée `.env` de façon interactive : mot de passe (haché par `docker run --rm` de l’image avec `scripts/hash-password.mjs`),
   `SESSION_SECRET` aléatoire, `ANTHROPIC_API_KEY`
   (optionnelle), `CLAUDE_MODEL`, `APP_PORT`. Ne réécrit pas un `.env` existant.
5. `docker compose up -d --build`, attend le healthcheck, affiche l'URL.

### `update.sh`
1. Sauvegarde `data/finance.db` → `backups/finance-YYYYmmdd-HHMMSS.db` (garde les 10 derniers).
2. `git pull --ff-only`.
3. `docker compose up -d --build`, attend le healthcheck.
4. En cas d'échec : message clair + commande de restauration de la sauvegarde.

Un script utilitaire `scripts/set-password.sh` permet de changer le mot de passe.

## 9. Hors périmètre (YAGNI)

Multi-utilisateurs, connexion bancaire directe, transactions récurrentes automatiques,
multi-devises complète (au-delà de la conversion des cours), application mobile native,
modification des données par l'IA.
