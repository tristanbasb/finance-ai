# Assistant proactif Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fil de discussion Claude persistant (app + Telegram), alertes temps réel, bilans hebdo/mensuels, notifications (cloche, toasts, Telegram) et choix du modèle en un clic.

**Architecture:** Tout dans le processus Next.js existant : `instrumentation.ts` démarre un planificateur (setInterval) et un bot Telegram (long polling via `fetch`). Un service `src/lib/assistant/` persiste les messages, génère les réponses (boucle d'outils existante `runChat`) et diffuse vers les canaux. Règles d'alerte pures dans `src/lib/alerts/`. Réglages en table clé/valeur.

**Tech Stack:** existant (Next.js 16, React 19, Tailwind v4, better-sqlite3 + Drizzle, zod 4, @anthropic-ai/sdk, vitest). Aucune nouvelle dépendance npm. API Telegram Bot via `fetch`. `after()` de `next/server` pour le travail post-réponse.

**Spec:** `docs/superpowers/specs/2026-10-25-assistant-proactif-design.md`

## Global Constraints

- UI et messages 100 % français ; montants en base en centimes entiers (prix unitaires REAL centimes) ; dates `YYYY-MM-DD` ; horodatages en ms epoch.
- L'IA reste en lecture seule sur les données financières ; seul le service assistant écrit dans `messages`.
- Aucune nouvelle dépendance npm.
- Erreurs API : `{ error: string }` + code HTTP via `withErrors` / `withAiErrors` existants ; toutes les nouvelles routes passent par l'auth (`src/proxy.ts`) et la protection CSRF existante.
- Tâches de fond : jamais au build (`NEXT_PHASE === 'phase-production-build'` → rien), démarrage unique par processus (garde `globalThis`), toute erreur journalisée sans tuer le serveur ; secrets (clé Anthropic, token Telegram) jamais journalisés ni renvoyés au client.
- Valeurs par défaut des préférences : alertes toutes activées, `unusualMinEur` 100, `priceMovePct` 5, bilans hebdo et mensuel activés, `hour` 8.
- Modèle : `settings.claude_model` > `CLAUDE_MODEL` > `claude-opus-5-5` ; liste de secours `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-fable-5-1`.
- Commits : conventionnels en français, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Doublons de tâches** (redémarrage, double démarrage en dev, deux requêtes simultanées) → jamais deux bilans pour la même période ni deux fois la même alerte : la « réservation » se fait par insertion conditionnelle en base (`INSERT … ON CONFLICT DO NOTHING` sur `alert_log` / mise à jour conditionnelle de `job_runs`) avant toute génération. Tests Task 5 et Task 6.
2. **Telegram : chat inconnu, message non textuel, message transféré, texte très long** → chat inconnu : « Ce bot est privé. » sans aucune donnée ; non-texte : « Je ne lis que le texte pour l'instant. » ; jamais de crash de la boucle. Tests Task 7.
3. **Messages concurrents** (app + Telegram en même temps, double clic) → traités l'un après l'autre (verrou + file), chacun reçoit sa réponse, l'ordre du fil reste cohérent. Tests Task 3.
4. **Changement de modèle vers un modèle sans `effort` ou disparu** → aucun paramètre non supporté envoyé ; si l'API répond « modèle introuvable », retour au modèle par défaut avec un message clair. Tests Task 2.
5. **Import CSV massif (5 000 lignes) déclenchant de nombreuses alertes** → un seul message groupé, import non ralenti (travail via `after()`), IA indisponible → texte modèle. Tests Task 5.

---

## File Structure

```
src/lib/db/schema.ts                 (+ messages, settings, alertLog, jobRuns ; prices.changePct)
drizzle/0001_*.sql                   (migration générée)
src/lib/settings.ts                  préférences typées (zod) + défauts
src/lib/queries/messages.ts          fil : ajout, liste, non-lus, lecture, contexte
src/lib/ai/models.ts                 liste des modèles (API + secours, cache 24 h), capacités
src/lib/ai/client.ts                 (getAi lit le modèle en réglages)
src/lib/assistant/lock.ts            verrou + file de génération
src/lib/assistant/dispatch.ts        diffusion vers les canaux enregistrés
src/lib/assistant/conversation.ts    réponse de Claude persistée (stream ou non)
src/lib/alerts/rules.ts              règles pures
src/lib/alerts/engine.ts             détection + dédup + message (Claude ou modèle)
src/lib/jobs/periods.ts              semaines ISO, échéances des bilans
src/lib/jobs/digests.ts              génération des bilans
src/lib/jobs/scheduler.ts            minuterie (bilans, cours horaires)
src/lib/telegram/api.ts              client Bot API (fetch injecté)
src/lib/telegram/format.ts           markdown → HTML Telegram, découpage
src/lib/telegram/bot.ts              boucle long polling, liaison, commandes, chat
src/instrumentation.ts               démarre scheduler + bot
src/app/api/messages/…               fil, non-lus, lecture, séparateur
src/app/api/ai/models, settings/{model,alerts,digests}, telegram/{link,status}
src/components/assistant/*           panneau, bulle, cloche, fil, sélecteur de modèle
src/components/settings/*            sections Notifications, Telegram, modèle
README.md, .env.example, install.sh  Telegram + modèle
```

---

### Task 1: Données — fil, réglages, journaux

**Files:** Modify `src/lib/db/schema.ts`; Create `drizzle/0001_*.sql` (via `npm run db:generate`), `src/lib/settings.ts`, `src/lib/queries/messages.ts`, `tests/messages.test.ts`, `tests/settings.test.ts`.

**Interfaces:** Produces:
- Tables `messages`, `settings`, `alertLog`, `jobRuns` (colonnes spec §3) ; `prices.changePct` real nullable.
- `type MessageKind = 'chat'|'alert'|'weekly'|'monthly'|'divider'`, `type MessageRole = 'user'|'assistant'|'divider'`, `type MessageSource = 'app'|'telegram'|'system'`, `type Message` (row, `meta` parsé en objet ou null).
- `addMessage(db, m: { role; kind; content; source; meta?; now?: number }): Message`
- `listMessages(db, { before?: number; limit?: number }): Message[]` (ordre chronologique, `limit` défaut 50, max 200)
- `unreadSummary(db): { count: number; latest: Message[] }` (assistant uniquement, non lus, ≤ 10, plus récents d'abord)
- `markRead(db, { ids?: number[]; all?: boolean }, now?: number): number`
- `contextMessages(db, { maxMessages = 40, maxChars = 30000 }): { role: 'user'|'assistant'; content: string }[]` — messages après le dernier `divider`, sans les dividers, fusion des messages consécutifs de même rôle (séparés par `\n\n`), troncature par le début sur les deux limites, premier élément forcément `user` (sinon retiré).
- `src/lib/settings.ts` : `getSetting<T>(db, key, schema, fallback): T`, `setSetting(db, key, value)`, `alertPrefs(db)`, `digestPrefs(db)`, `getModelSetting(db): string | null`, schémas zod `alertPrefsSchema`, `digestPrefsSchema` avec défauts de Global Constraints ; valeur invalide en base → défaut.

- [ ] Step 1: Tests : ajout/liste/pagination `before` ; non-lus ignorent user/divider ; `markRead` ids et all ; `contextMessages` coupe au dernier divider, fusionne `assistant`+`assistant`, respecte 40/30 000, commence par `user` ; réglages : défaut si absent, défaut si JSON invalide, aller-retour.
- [ ] Step 2: FAIL → Step 3: schéma + `npm run db:generate` (migration additive, la 0000 inchangée) + implémentation → Step 4: PASS (+ test de migration sur base mémoire existant toujours vert).
- [ ] Step 5: Commit `feat: fil de messages, réglages et journaux en base`.

### Task 2: Choix du modèle

**Files:** Create `src/lib/ai/models.ts`, `src/app/api/ai/models/route.ts`, `src/app/api/settings/model/route.ts`, `tests/models.test.ts`; Modify `src/lib/ai/client.ts`, `src/lib/ai/categorize.ts`, `src/app/api/ai/status/route.ts`.

**Interfaces:** Consumes `getModelSetting`, `setSetting` (Task 1). Produces:
- `FALLBACK_MODELS: { id: string; name: string }[]` (4 modèles, noms : « Claude Opus 5.5 », « Claude Sonnet 5.5 », « Claude Haiku 5.5 », « Claude Fable 5.1 »).
- `listModels(ai: Ai | null, now = Date.now()): Promise<{ id; name }[]>` — `ai.client.models.list()` (toutes pages, uniquement ids `claude-*`), cache module 24 h, secours sur erreur ou IA absente.
- `modelSupports(model: string, feature: 'effort'): boolean` (liste blanche des familles 5.x).
- `getAi(db?: Db)` : modèle = réglage > env > défaut (signature compatible, `db` optionnel → `getDb()`).
- `GET /api/ai/models` → `{ models, current }` ; `PUT /api/settings/model` `{ model }` → 200 `{ model }` si présent dans `listModels`, sinon 400 « Modèle inconnu ». `GET /api/ai/status` renvoie le modèle effectif.
- `isModelNotFound(err): boolean` (APIError 404 `not_found_error`).
- `categorize` n'envoie `effort` que si `modelSupports`.

- [ ] Step 1: Tests (client simulé) : liste paginée filtrée ; cache 24 h ; secours sur erreur ; `getAi` priorité réglage > env ; PUT refuse un id inconnu ; `categorize` sans `effort` pour un modèle non supporté.
- [ ] Step 2: FAIL → Step 3: implémenter → Step 4: PASS.
- [ ] Step 5: Commit `feat: choix du modèle Claude depuis l'application`.

### Task 3: Service assistant et API du fil

**Files:** Create `src/lib/assistant/{lock,dispatch,conversation}.ts`, `src/app/api/messages/route.ts`, `src/app/api/messages/unread/route.ts`, `src/app/api/messages/read/route.ts`, `src/app/api/messages/divider/route.ts`, `tests/assistant.test.ts`; Modify `src/lib/ai/chat.ts` (prompt système : mention Telegram), `src/app/api/ai/chat/route.ts`.

**Interfaces:** Consumes Task 1, `runChat`, `getAi`, `isModelNotFound` (Task 2). Produces:
- `withGenerationLock<T>(fn: () => Promise<T>): Promise<T>` (file FIFO, une génération à la fois, ne bloque pas sur l'échec d'une précédente).
- `registerChannel(name: string, send: (m: Message) => Promise<void>): () => void` ; `dispatch(m: Message, opts?: { except?: string }): Promise<void>` (erreurs de canal journalisées, jamais propagées).
- `postAssistantMessage(db, { kind, content, meta? }): Promise<Message>` (source `system`, enregistre puis `dispatch`).
- `respond(db, { ai, source: 'app'|'telegram', signal?, onEvent?: (e: ChatEvent) => void, today? }): Promise<Message>` — sous verrou : contexte (`contextMessages`), `runChat`, accumule le texte, enregistre le message assistant (`kind: 'chat'`), texte partiel + « (interrompu) » si abort après du texte, rien si abort sans texte ; `dispatch(message, { except: source })`. Erreur « modèle introuvable » → réinitialise `claude_model` et lève une erreur française « Le modèle choisi n'est plus disponible ; modèle par défaut rétabli. ».
- `POST /api/ai/chat` body `{ content: string (1–8000) }` : enregistre le message user (source `app`), puis SSE comme aujourd'hui (texte, tool, `{type:'saved', id}`, done, error, heartbeat) alimenté par `respond(..., onEvent)`.
- Routes fil : `GET /api/messages?before=&limit=`, `GET /api/messages/unread`, `POST /api/messages/read` `{ ids?: number[] } | { all: true }`, `POST /api/messages/divider` → message divider.

- [ ] Step 1: Tests (client Anthropic simulé, base mémoire) : réponse persistée + `dispatch` appelé avec `except` ; deux `respond` lancés en même temps → exécutés en série, deux réponses, ordre user/assistant cohérent ; abort avec texte partiel → « (interrompu) » ; modèle introuvable → réglage effacé + erreur ; route chat : 400 si vide, événement `saved` ; routes fil (non-lus, lecture, divider).
- [ ] Step 2: FAIL → Step 3: implémenter → Step 4: PASS ; `npm run build`.
- [ ] Step 5: Commit `feat: fil persistant et service de réponse de l'assistant`.

### Task 4: Alertes en temps réel

**Files:** Create `src/lib/alerts/{rules,engine}.ts`, `tests/alerts.test.ts`; Modify `src/lib/prices/{index,yahoo,coingecko}.ts` (variation du jour), routes transactions (POST, `[id]` PATCH, import), `prices/refresh`, goals (POST, `[id]` PATCH), accounts `[id]` PATCH.

**Interfaces:** Consumes Tasks 1–3, `alertPrefs`. Produces:
- Règles pures : `budgetAlerts(input)`, `unusualExpense(input)`, `priceMoveAlerts(input)`, `goalReachedAlerts(input)` → `Alert[]` où `Alert = { key: string; type: 'budget80'|'budget100'|'expense'|'price'|'goal'; facts: Record<string, string|number> }` (clés de dédup de la spec §6 ; médiane 90 j, ≥ 5 dépenses sinon seuil × 2).
- `PriceFetcher` renvoie aussi `changePct?: number` (Yahoo `regularMarketChangePercent`, CoinGecko `eur_24h_change`), stocké dans `prices.changePct`.
- `claimAlerts(db, alerts): Alert[]` (insertion `alert_log` ON CONFLICT DO NOTHING, renvoie les nouvelles).
- `alertMessage(ai: Ai | null, alerts: Alert[]): Promise<string>` (Claude sans outils, `max_tokens` 600, 2–4 phrases par alerte, groupées en un message ; texte modèle français si `ai` null ou erreur).
- `runAlertChecks(db, scope: { txIds?: number[]; prices?: boolean; goals?: boolean }): Promise<void>` → préférences, règles, `claimAlerts`, un `postAssistantMessage({ kind: 'alert', meta: { keys } })` si ≥ 1.
- Câblage via `after(() => runAlertChecks(...))` dans les routes listées (import : tous les ids créés en un seul appel).

- [ ] Step 1: Tests : chaque règle (seuils 80/100, médiane, < 5 dépenses, variation ±, objectif) ; préférences désactivées → rien ; `claimAlerts` deux fois → une seule ; import de 50 tx déclenchant 30 alertes → 1 message ; IA en erreur → texte modèle ; `changePct` stocké.
- [ ] Step 2: FAIL → Step 3: implémenter → Step 4: PASS.
- [ ] Step 5: Commit `feat: alertes budget, dépenses, cours et objectifs`.

### Task 5: Planificateur et bilans

**Files:** Create `src/lib/jobs/{periods,digests,scheduler}.ts`, `src/app/api/settings/alerts/route.ts`, `src/app/api/settings/digests/route.ts`, `tests/jobs.test.ts`; Modify `src/instrumentation.ts`.

**Interfaces:** Consumes Tasks 1–4, `refreshPrices` + fetchers, `recordSnapshot`, `runChat`. Produces:
- `isoWeek(date: Date): string` (`YYYY-Www`), `dueDigests(now: Date, prefs, lastRuns: { weekly?: string; monthly?: string }): ('weekly'|'monthly')[]` (heure locale ≥ `hour`, période ≠ dernière ; hebdo seulement si on est lundi ou plus tard dans la semaine ISO, mensuel dès le 1er).
- `claimJob(db, job, period): boolean` (mise à jour conditionnelle atomique de `job_runs`).
- `generateDigest(db, ai, kind, now): Promise<string>` (prompt dédié + outils via `runChat`, texte concaténé ; périodes : semaine ISO précédente / mois précédent).
- `tick(db, now, deps)` : bilans dus (claim puis génération puis `postAssistantMessage({kind})` ; IA absente → message court unique « Activez l'IA… » une seule fois par type, mémorisé en réglage) ; cours toutes les heures si positions (`claimJob(db,'prices', 'YYYY-MM-DDTHH')`) → `refreshPrices` → `recordSnapshot` → `runAlertChecks({ prices: true, goals: true })`.
- `startScheduler(db, { intervalMs = 60_000 })` : garde `globalThis.__financeScheduler`, `tick` immédiat (rattrapage) puis intervalle ; erreurs journalisées.
- `instrumentation.ts` : après migrations/seed, si pas `phase-production-build` : `startScheduler`, `startBot` (Task 7, import dynamique protégé si absent).
- Routes `GET/PUT /api/settings/alerts|digests` (zod, défauts).

- [ ] Step 1: Tests (horloge injectée) : `isoWeek` (1er janvier, semaine 53) ; `dueDigests` avant/après 8 h, lundi/mardi, 1er/2 ; deux `claimJob` concurrents → un seul vrai ; `tick` génère un bilan hebdo une seule fois sur deux ticks ; rattrapage au premier tick ; IA absente → message unique ; cours horaires une fois par heure.
- [ ] Step 2: FAIL → Step 3: implémenter → Step 4: PASS ; `npm run build` (aucun démarrage au build).
- [ ] Step 5: Commit `feat: bilans hebdomadaires et mensuels planifiés`.

### Task 6: Bot Telegram

**Files:** Create `src/lib/telegram/{api,format,bot}.ts`, `src/app/api/telegram/link/route.ts`, `src/app/api/telegram/status/route.ts`, `tests/telegram.test.ts`.

**Interfaces:** Consumes Tasks 1–3, `listModels`, `setSetting`. Produces:
- `telegramApi(token, fetchImpl = fetch)` → `{ getUpdates(offset, timeoutSec), sendMessage(chatId, html), sendChatAction(chatId, 'typing') }` (timeouts, erreurs `TelegramError` sans token dans le message).
- `toTelegramHtml(markdown: string): string` (gras, italique, code, listes « • », échappement `& < >`) ; `splitMessage(text, max = 4000): string[]` (coupe aux paragraphes puis lignes).
- `handleUpdate(ctx, update)` pur-ish (dépendances injectées) : `/start <code>` (code valide et non expiré → `telegram_chat_id`), `/bilan` = message utilisateur « Fais-moi un bilan de mon mois en cours. » puis réponse normale, chat inconnu → « Ce bot est privé. », non-texte → « Je ne lis que le texte pour l'instant. », `/nouveau`, `/bilan`, `/modele [id]`, `/aide`, texte → `addMessage(source telegram)` + `respond(source 'telegram')` avec `typing` toutes les 4 s → réponse envoyée.
- `startBot(db)` : si `TELEGRAM_BOT_TOKEN`, garde `globalThis`, boucle `getUpdates` (timeout 30 s, reprise exponentielle 1→60 s), `registerChannel('telegram', …)` envoyant les messages assistant au chat relié.
- `POST /api/telegram/link` → `{ code (6 chiffres), expiresAt }` (10 min) ; `DELETE /api/telegram/link` ; `GET /api/telegram/status` → `{ configured, linked, botUsername? }` (via `getMe`, mis en cache).

- [ ] Step 1: Tests (API simulée) : liaison valide/expirée/fausse ; chat inconnu → message privé, aucun accès aux données ; sticker → réponse texte ; `/modele claude-sonnet-5-5` change le réglage ; texte → réponse envoyée découpée si > 4000 ; HTML échappé ; erreur réseau → la boucle continue.
- [ ] Step 2: FAIL → Step 3: implémenter → Step 4: PASS.
- [ ] Step 5: Commit `feat: bot Telegram pour discuter et recevoir les notifications`.

### Task 7: Interface — bulle, panneau, cloche, page Assistant

**Files:** Create `src/components/assistant/{chat-panel,chat-bubble,thread,composer,model-select,notification-bell,use-unread}.tsx`, `src/components/dashboard/latest-message-card.tsx`; Modify `src/components/assistant/chat.tsx` (ou remplacer), `src/app/(app)/layout.tsx`, `src/app/(app)/assistant/page.tsx`, `src/app/(app)/page.tsx`, `src/components/{sidebar,mobile-nav}.tsx`, `src/lib/assistant-storage.ts` (suppression de l'ancienne clé).

**Interfaces:** Consumes routes Tasks 2–3. Produces composants clients ; un contexte React `AssistantProvider` (état ouvert/fermé, `openAt(messageId)`, compteur non-lus) monté dans `(app)/layout.tsx`.

- [ ] Step 1: Charger le skill `anthropic-skills:frontend-design` ; réutiliser les primitives `src/components/ui/*`.
- [ ] Step 2: Fil (`thread`) : messages user/assistant, étiquettes Alerte/Bilan hebdo/Bilan mensuel, séparateurs « Nouvelle conversation », source Telegram signalée, chargement « plus ancien », rendu markdown sûr existant, streaming de la réponse en cours (SSE existant + `saved`).
- [ ] Step 3: Panneau latéral (plein écran mobile) + bulle (pastille non-lus, masquée sur `/login` et `/assistant`) + page Assistant pleine page réutilisant le même fil ; `model-select` (GET models, PUT setting, toast) dans l'en-tête ; « Nouvelle conversation ».
- [ ] Step 4: Cloche (sidebar + en-tête mobile) : compteur, menu des 10 derniers, « Tout marquer comme lu », clic → panneau ; `use-unread` interroge `/api/messages/unread` toutes les 20 s et sur `visibilitychange` ; toast à l'arrivée d'un nouveau message si panneau fermé ; marquage lu à l'affichage.
- [ ] Step 5: Carte « Dernier message de Claude » en haut du tableau de bord.
- [ ] Step 6: Vérifier dans le navigateur (desktop/mobile, clair/sombre, IA désactivée, faux serveur Anthropic via `ANTHROPIC_BASE_URL` pour le flux) ; accessibilité (focus, aria-live, Esc ferme le panneau).
- [ ] Step 7: Commit `feat: bulle de chat, panneau et notifications dans l'application`.

### Task 8: Réglages — modèle, notifications, Telegram

**Files:** Create `src/components/settings/{notifications-settings,telegram-settings,model-settings}.tsx`; Modify `src/app/(app)/settings/page.tsx`, `src/components/settings/ai-status.tsx`.

- [ ] Step 1: Section Assistant IA : sélecteur de modèle (même composant que Task 7 si possible).
- [ ] Step 2: Section Notifications (`#notifications`) : interrupteurs des 4 alertes, seuils (€ et %), bilans hebdo/mensuel, heure ; enregistrement via PUT.
- [ ] Step 3: Section Telegram (`#telegram`) : non configuré → étapes @BotFather + `TELEGRAM_BOT_TOKEN` + `./update.sh` ; configuré non relié → bouton « Relier » affichant le code, le nom du bot et `/start CODE` (copie), compte à rebours ; relié → « Délier ».
- [ ] Step 4: Vérifier dans le navigateur ; Commit `feat: réglages du modèle, des notifications et de Telegram`.

### Task 9: Installation et documentation

**Files:** Modify `.env.example`, `install.sh`, `scripts/lib.sh` (si besoin), `README.md`.

- [ ] Step 1: `.env.example` : `TELEGRAM_BOT_TOKEN=` (facultatif, explication @BotFather) ; `CLAUDE_MODEL` = valeur par défaut, modifiable dans l'app.
- [ ] Step 2: `install.sh` : question facultative du token Telegram (masquée ; non interactif via `TELEGRAM_BOT_TOKEN`), écrit dans `.env` ; `.env` existant inchangé.
- [ ] Step 3: README : section « Assistant proactif » (alertes, bilans, cloche), « Telegram » (création du bot, liaison, commandes), « Changer de modèle » ; captures si possible.
- [ ] Step 4: `bash -n` + shellcheck `-x` (0 finding), `npm test`, typecheck, lint, build, `docker build` ; Commit `docs: assistant proactif, Telegram et choix du modèle`.
