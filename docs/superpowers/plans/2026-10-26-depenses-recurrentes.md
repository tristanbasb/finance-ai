# Dépenses récurrentes et prévision de fin de mois — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Récurrentes déclarées et validées à la main (création de l'opération), prévision de fin de mois (Budgets + Accueil), « Puis-je acheter ? » (app + Claude).

**Architecture:** Tables `recurring` et `recurring_payments` ; calcul pur dans `src/lib/forecast.ts` + requêtes dans `src/lib/queries/recurring.ts` ; routes API zod ; UI Budgets/Accueil/Réglages ; outil de lecture `get_forecast`.

**Tech Stack:** existant (Next.js 16, React 19, Tailwind v4, lucide-react, SQLite/Drizzle, zod 4, vitest). Aucune nouvelle dépendance.

**Spec:** `docs/superpowers/specs/2026-10-26-depenses-recurrentes-design.md`

## Global Constraints

- Aucun emoji ; français avec « vous » ; boutons réels avec icônes lucide + texte ; 375/1440 px, clair/sombre.
- Montants en centimes entiers en base ; `recurring.amount` > 0 (dépense) ; l'opération créée a `amount = −montant`.
- Fréquences `monthly` | `quarterly` | `yearly` ; `anchorMonth` 1-12 requis si non mensuelle, null sinon.
- Période `YYYY-MM` (mois local, `todayLocal()`).
- Prévision = Σ soldes des comptes `checking` non archivés − Σ récurrentes `due` du mois dont le compte est `checking` non archivé.
- Marge : réglage `forecast_margin`, centimes ≥ 0, défaut 20 000. `canAfford` : `forecast − price ≥ margin`.
- Supprimer l'opération d'un paiement remet la récurrente « à payer » (cascade).
- Réinitialisation de l'application (`src/lib/reset.ts`) efface aussi `recurring` et `recurring_payments`.
- Alertes : l'opération créée par « Valider » appelle `scheduleAlertChecks({ txIds: [id], goals: true })` comme `POST /api/transactions`.
- Commits conventionnels en français, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Double validation** (double clic sur « Valider », deux onglets) → une seule opération ; la seconde requête reçoit 409. Test Task 2.
2. **Catégorie ou compte supprimé/archivé après déclaration** → catégorie null acceptée ; compte archivé : la récurrente reste listée mais hors prévision, « Valider » propose un autre compte. Tests Task 1 (prévision) et Task 2 (pay avec `accountId` archivé → 400).
3. **Opération modifiée ou supprimée depuis la page Activité** → suppression : la récurrente redevient due ; modification du montant : la récurrente reste payée. Test Task 2.
4. **Trimestrielle/annuelle** ancrées sur un mois passé ou futur → dues exactement les bons mois, y compris décembre→janvier. Test Task 1.
5. **Montant de « Puis-je acheter » invalide** (vide, négatif, « 1 234,56 », très grand) → message clair, aucun appel cassé. Tests Task 2 (route) et Task 4 (parse via `parseAmount`).

---

### Task 1: Données et calcul

**Files:** Modify `src/lib/db/schema.ts`, `src/lib/reset.ts`, `src/lib/validation.ts` ; Create `drizzle/0005_*.sql` (`npm run db:generate`, additif), `src/lib/forecast.ts`, `src/lib/queries/recurring.ts` ; Test `tests/forecast.test.ts`, `tests/reset.test.ts`.

**Interfaces (produces):**
- Schéma `recurring` { id, label, amount, categoryId (fk set null), accountId (fk restrict), frequency, anchorMonth (int null), active (bool, défaut vrai), createdAt } ; `recurringPayments` { recurringId (fk cascade), period, transactionId (fk transactions **cascade**, null), skipped (bool), createdAt ; PK (recurringId, period) }.
- `recurringInput` (zod, dans `validation.ts`) : `{ label 1-80, amount int 1..99_999_999_999, categoryId int|null, accountId int, frequency, anchorMonth 1-12|null, active? }` avec contrôle anchorMonth/fréquence.
- `isDue(r: { frequency; anchorMonth: number | null; active: boolean }, period: string): boolean`.
- `type RecurringStatus = "due" | "paid" | "skipped"` ; `type MonthRecurring = { id; label; amount; categoryId; categoryName: string | null; accountId; accountName; frequency; anchorMonth; status: RecurringStatus; transactionId: number | null; inForecast: boolean }`.
- `listRecurring(db): Recurring[]` ; `monthRecurring(db, period): MonthRecurring[]` (actives et dues) ; `forecastFor(db, period): { checkingBalance: number; dueTotal: number; forecast: number; margin: number; items: MonthRecurring[] }` ; `canAfford(forecast: number, margin: number, price: number): { ok: boolean; remaining: number; missing: number }`.
- `getForecastMargin(db): number` / `setForecastMargin(db, cents)` dans `src/lib/settings.ts`.

- [ ] **Step 1: Tests** — `isDue` : mensuelle toujours ; trimestrielle ancrée 11 → dues 2026-11, 2027-02, pas 2026-12 ; annuelle ancrée 1 → due 2027-01 seulement ; inactive jamais. `forecastFor` : 2 comptes courants (1 000 € et 200 €) + un livret (5 000 €) ; récurrentes 50 € due, 30 € payée, 20 € passée, 40 € sur le livret → `checkingBalance` 120 000, `dueTotal` 5 000, `forecast` 115 000, item livret `inForecast` false ; compte courant archivé exclu. `canAfford(115000, 20000, 40000)` → ok, remaining 75 000, missing 0 ; `canAfford(30000, 20000, 20000)` → non, missing 10 000 ; marge 0. Suppression de l'opération d'un paiement → statut `due`. `resetDatabase` vide les deux tables.
- [ ] **Step 2:** FAIL → **Step 3:** implémenter → **Step 4:** PASS (`npm test`, typecheck).
- [ ] **Step 5:** Commit `feat(récurrentes): données et calcul de la prévision`.

### Task 2: API

**Files:** Create `src/app/api/recurring/route.ts`, `src/app/api/recurring/[id]/route.ts`, `src/app/api/recurring/[id]/pay/route.ts`, `src/app/api/recurring/[id]/skip/route.ts`, `src/app/api/recurring/[id]/payments/[period]/route.ts`, `src/app/api/forecast/route.ts`, `src/app/api/settings/forecast-margin/route.ts` ; Modify `src/lib/queries/recurring.ts` ; Test `tests/recurring-routes.test.ts`.

**Interfaces:**
- Consumes Task 1.
- Produces : `payRecurring(db, id, { period, amount, date, accountId }): Transaction` (transaction SQL : vérifie période libre → 409 `ConflictError("Déjà validée pour ce mois.")`, compte non archivé → 400, crée l'opération `{ label, categoryId, accountId, date, amount: −amount }`, insère le paiement) ; `skipRecurring(db, id, period)` (409 si existant) ; `undoPayment(db, id, period)` (supprime l'opération liée si présente, puis la ligne ; 404 si absente).
- Routes : `GET /api/recurring` → `{ items: Recurring[] }` ; `POST` → 201 ; `PATCH/DELETE /api/recurring/[id]` ; `POST …/pay` body `{ period, amount (centimes > 0), date YYYY-MM-DD, accountId }` → 201 `{ transaction }` puis `scheduleAlertChecks({ txIds: [id], goals: true })` ; `POST …/skip` `{ period }` ; `DELETE …/payments/[period]` → 204 ; `GET /api/forecast?price=<centimes>` → `{ checkingBalance, dueTotal, forecast, margin, items, afford? }` (price entier 1..99_999_999_999, 400 sinon) ; `GET/PUT /api/settings/forecast-margin` `{ margin }`.

- [ ] **Step 1: Tests** — pay crée l'opération (montant négatif, libellé, catégorie) et la statut `paid` ; deuxième pay même période → 409 et une seule opération ; pay sur compte archivé → 400 ; skip puis pay → 409 ; undo supprime l'opération ; `DELETE` de l'opération via `deleteTransaction` → due ; forecast `price=abc` → 400, `price=40000` → `afford.ok` ; margin PUT −1 → 400 ; période invalide `2026-13` → 400.
- [ ] **Step 2:** FAIL → **Step 3:** implémenter (lire `node_modules/next/dist/docs/` pour les params async ; copier le style des routes existantes) → **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(récurrentes): API de gestion, validation et prévision`.

### Task 3: Réglages

**Files:** Create `src/components/settings/recurring-manager.tsx`, `src/components/settings/recurring-dialog.tsx` ; Modify `src/app/(app)/settings/page.tsx`, `src/components/settings/settings-nav.tsx`, `src/lib/settings-ui.ts` (+ test).

**Interfaces:** Consumes Task 2 routes. Section « Dépenses récurrentes » (`id="recurrentes"`, ajoutée au menu des Réglages) : liste (libellé, montant, fréquence lisible « Tous les mois » / « Tous les 3 mois (à partir de mars) » / « Chaque année en mars », catégorie, compte, « En pause ») ; bouton « Ajouter » ; dialogue (libellé, montant via `parseAmount`, catégorie de dépense, compte non archivé, fréquence, mois de référence si non mensuelle, interrupteur « Active », « Supprimer » avec confirmation) ; champ « Marge de sécurité » (euros, enregistrement + toast).
- Produces : `frequencyLabel(frequency, anchorMonth): string` dans `src/lib/settings-ui.ts`.

- [ ] **Step 1:** Test `frequencyLabel` (3 fréquences, mois en français).
- [ ] **Step 2:** FAIL → **Step 3:** implémenter → **Step 4:** PASS ; build.
- [ ] **Step 5:** Commit `feat(récurrentes): gestion dans les Réglages`.

### Task 4: Budgets et Accueil

**Files:** Create `src/components/budgets/forecast-card.tsx`, `src/components/budgets/recurring-month.tsx`, `src/components/budgets/pay-dialog.tsx`, `src/lib/forecast-ui.ts` (+ test) ; Modify `src/app/(app)/budgets/page.tsx`, `src/components/dashboard/month-stats.tsx`, `src/app/(app)/page.tsx`.

**Interfaces:** Consumes Tasks 1-2. Budgets (mois courant seulement, au-dessus de la liste des budgets) : carte « Fin de mois » et liste « Récurrentes du mois » selon spec §4 (textes exacts) ; invitation si aucune récurrente. « Valider » → dialogue (montant prérempli, date du jour, compte = celui de la récurrente sinon `defaultAccountId`) → POST pay → `router.refresh()` + toast. Accueil : ligne dans `MonthStats` si au moins une récurrente.
- Produces : `affordMessage(afford, margin): { tone: "ok" | "ko"; text: string }` (textes exacts de la spec §4) dans `src/lib/forecast-ui.ts`.

- [ ] **Step 1:** Test `affordMessage` (oui, non, marge 0) et parsing du montant saisi (`parseAmount` : « 1 234,56 », vide, négatif).
- [ ] **Step 2:** FAIL → **Step 3:** implémenter → **Step 4:** PASS ; build.
- [ ] **Step 5:** Vérification navigateur (base de test) : déclarer 3 récurrentes (mensuelle, trimestrielle due, annuelle non due), valider, passer, annuler, « Puis-je acheter » oui/non, ligne Accueil ; 375/1440, clair/sombre.
- [ ] **Step 6:** Commit `feat(récurrentes): fin de mois et récurrentes dans Budgets et l'Accueil`.

### Task 5: Claude et documentation

**Files:** Modify `src/lib/ai/tools.ts`, `src/components/assistant/thread.tsx` (libellé d'outil), `src/lib/ai/chat.ts` (listes de ce que Claude consulte), `README.md` ; Test `tests/ai.test.ts`.

**Interfaces:** Outil `get_forecast { price?: number (euros, > 0, 2 décimales) }` → `{ currency, period, checking_balance, due_total, forecast, margin, due: { label, amount }[], afford?: { price, can_afford, remaining, missing } }` (euros) ; description : prévision hors dépenses courantes, donc optimiste. Absent de `writeTools`. README : fonctionnalité, Réglages, exemple « Est-ce que je peux m'acheter un vélo à 400 € ? ».

- [ ] **Step 1:** Tests `get_forecast` avec/sans `price`, `price: -1` → erreur, présent dans `aiTools` et absent de `writeTools`.
- [ ] **Step 2:** FAIL → **Step 3:** implémenter → **Step 4:** PASS ; `npm test`, typecheck, lint, build.
- [ ] **Step 5:** Commit `feat(récurrentes): prévision pour Claude et documentation`.
