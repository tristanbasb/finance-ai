# Assistant proactif, notifications et Telegram — Spécification de conception

Date : 2026-10-25
Statut : approuvée (conversation), en revue écrite
S'appuie sur : `2026-10-24-finance-ai-design.md` (application existante)

## 1. Objectif

Aujourd'hui l'utilisateur doit aller chercher l'information. On veut que **l'information
vienne à lui** :

- un **chatbot Claude** central pour tout ce qui touche à ses finances, accessible partout ;
- Claude **écrit de lui-même** : alertes en temps réel, bilan hebdomadaire, bilan mensuel ;
- **notifications** dans l'app (cloche, toasts) et sur **Telegram**, où l'on peut aussi
  discuter avec Claude ;
- **changer de modèle Claude** en un clic.

### Critères de réussite

1. Une alerte de budget déclenchée par une nouvelle transaction apparaît dans la cloche de
   l'app en ≤ 30 s et sur Telegram en ≤ 10 s.
2. Le lundi à 8 h (heure du serveur, `TZ`), un bilan hebdomadaire arrive dans le fil et sur
   Telegram ; le 1er du mois à 8 h, un bilan mensuel. Un bilan manqué (app arrêtée) est
   envoyé au redémarrage, une seule fois.
3. Un message envoyé au bot Telegram reçoit une réponse de Claude, visible aussi dans l'app.
4. Le modèle se change depuis le chat ou les Réglages, sans redémarrage ; la liste des
   modèles provient de l'API Anthropic.
5. Sans clé API ni bot Telegram, l'app fonctionne ; alertes envoyées en texte modèle dans
   l'app, bilans IA désactivés.

### Décisions de cadrage (utilisateur)

- Messages proactifs : alertes temps réel, bilan hebdo, bilan mensuel (pas d'analyse
  automatique après import CSV).
- Notifications : cloche dans l'app + Telegram (pas de Web Push).
- Telegram : chatbot bidirectionnel.
- Interface : tableau de bord conservé en accueil + bulle de chat flottante + cloche.

## 2. Architecture

Tout tourne dans le **processus serveur existant** (approche A, pas de conteneur
supplémentaire, `install.sh`/`update.sh` inchangés dans leur principe).

- `src/instrumentation.ts` démarre, côté runtime Node uniquement et hors phase de build,
  un **planificateur** (`src/lib/jobs/scheduler.ts`) et le **bot Telegram**
  (`src/lib/telegram/bot.ts`). Démarrage idempotent (garde sur `globalThis`) pour éviter
  les doublons en développement.
- **Service de messagerie** (`src/lib/assistant/`) : point unique pour ajouter un message
  au fil, générer une réponse de Claude et **diffuser** (« dispatch ») vers les canaux :
  l'app (lecture en base) et Telegram (envoi immédiat si relié).
- Les **alertes** sont détectées par des règles déterministes (`src/lib/alerts/`), appelées
  après chaque écriture pertinente (création/édition/import de transactions, actualisation
  des cours, modification d'objectif) et par le planificateur.

## 3. Modèle de données (nouvelles tables)

| Table | Colonnes |
|---|---|
| `messages` | id, role (`user`/`assistant`/`divider`), kind (`chat`/`alert`/`weekly`/`monthly`/`divider`), content (texte markdown), source (`app`/`telegram`/`system`), read_at (nullable, ms), created_at (ms), meta (JSON nullable : ids liés, niveau d'alerte) |
| `settings` | key (PK), value (JSON texte), updated_at |
| `alert_log` | key (PK, ex. `budget:12:2026-10:80`), created_at, message_id (nullable) |
| `job_runs` | job (PK : `weekly`/`monthly`/`prices`), last_period (texte, ex. `2026-W43`, `2026-10`), last_run_at |

Index : `messages(created_at)`, `messages(read_at)`.

Clés de `settings` : `claude_model` (string), `telegram_chat_id` (string), 
`telegram_link_code` ({code, expiresAt}), `alerts` ({enabled, budget: bool,
unusualExpense: bool, unusualMinEur: number, priceMove: bool, priceMovePct: number,
goalReached: bool}), `digests` ({weekly: bool, monthly: bool, hour: number}).

Valeurs par défaut : tout activé, `unusualMinEur` 100, `priceMovePct` 5, `hour` 8.

## 4. Le fil de discussion

- **Un fil unique** partagé entre l'app et Telegram. Les messages proactifs y sont ajoutés
  avec leur `kind`.
- **Contexte envoyé à Claude** : les messages depuis le dernier séparateur (`divider`),
  limités aux 40 derniers et à ~30 000 caractères (les plus anciens sont omis). Les messages
  proactifs font partie du contexte (l'utilisateur peut répondre « explique-moi cette
  alerte »).
- « Nouvelle conversation » (bouton ou `/nouveau`) insère un `divider`.
- Les outils de Claude restent **en lecture seule** (outils existants). Le prompt système
  existant est réutilisé, enrichi : Claude peut recevoir des messages via Telegram (format
  plus court, pas de tableaux).
- **Génération côté serveur** : une réponse est générée côté serveur et enregistrée en base
  (pas seulement streamée), pour que l'app et Telegram la voient. L'app garde le streaming
  SSE pour l'affichage en direct ; le message final est persisté à la fin du flux (ou le
  texte partiel + mention « (interrompu) » en cas d'arrêt).
- Une seule génération à la fois (verrou en mémoire) ; un message reçu pendant une
  génération est mis en file et traité ensuite.
- L'ancien historique `localStorage` de l'assistant est abandonné (clé supprimée au
  chargement).

## 5. Interface

- **Bulle de chat** sur toutes les pages (sauf `/login` et `/assistant`) : bouton rond en
  bas à droite (au-dessus de la barre d'onglets sur mobile), pastille de non-lus. Ouvre un
  **panneau latéral** (plein écran sur mobile) avec le fil, le champ de saisie, le menu du
  modèle et « Nouvelle conversation ».
- **Page Assistant** : même fil en pleine page (remplace l'implémentation localStorage).
- **Cloche** dans la barre latérale (desktop) et l'en-tête mobile : compteur de messages
  de Claude non lus ; menu listant les 10 derniers (icône selon `kind`, extrait, date
  relative) ; « Tout marquer comme lu » ; clic → ouvre le panneau sur ce message.
- **Toasts** quand un nouveau message de Claude arrive pendant que l'app est ouverte et que
  le panneau est fermé.
- **Rafraîchissement** : `GET /api/messages/unread` toutes les 20 s et au retour sur
  l'onglet (`visibilitychange`) ; le panneau ouvert recharge le fil.
- Un message est marqué **lu** quand il est affiché dans le panneau ouvert ou la page
  Assistant (ou via « Tout marquer comme lu »). Les messages envoyés sur Telegram ne
  sont pas marqués lus automatiquement.
- **Tableau de bord** : carte « Dernier message de Claude » en haut (extrait du dernier
  message assistant non-chat, bouton « Ouvrir »). La carte « Analyse IA » existante est
  conservée.

## 6. Alertes en temps réel

Règles (`src/lib/alerts/rules.ts`, pures, testées) :

| Règle | Déclenchement | Clé de déduplication |
|---|---|---|
| Budget 80 % | dépenses du mois d'une catégorie ≥ 80 % du budget | `budget:<catId>:<YYYY-MM>:80` |
| Budget dépassé | > 100 % | `budget:<catId>:<YYYY-MM>:100` |
| Dépense inhabituelle | nouvelle dépense ≥ `unusualMinEur` ET ≥ 3 × médiane des dépenses de la catégorie sur 90 jours (si ≥ 5 dépenses ; sinon seuil seul ×2) | `expense:<txId>` |
| Variation d'un actif | variation du cours ≥ ± `priceMovePct` % par rapport au cours de clôture précédent (Yahoo `regularMarketChangePercent`, CoinGecko `eur_24h_change`) | `price:<symbol>:<YYYY-MM-DD>:<up/down>` |
| Objectif atteint | `goalProgress().pct >= 1` | `goal:<goalId>` |

- Déclencheurs : après création/édition/import de transactions (règles budget + dépense
  inhabituelle, limitée aux transactions créées), après actualisation des cours (variation),
  après modification d'objectif ou changement de solde (objectif). Exécution asynchrone
  après la réponse HTTP (ne ralentit pas l'UI) ; erreurs journalisées.
- Une alerte = un message `kind: alert` : rédigé par Claude (2–4 phrases, chiffres
  fournis, pas d'outils, `max_tokens` bas) ; **texte modèle** si l'IA est désactivée ou en
  erreur. Lors d'un import massif, les alertes sont **regroupées** en un seul message.
- Les cours sont actualisés **toutes les heures** par le planificateur (en plus du bouton),
  ce qui alimente aussi les snapshots.

## 7. Bilans planifiés

- Planificateur : vérification **toutes les minutes** (timer léger). Période courante :
  semaine ISO (`YYYY-Www`) et mois (`YYYY-MM`). Si l'heure locale ≥ `digests.hour` et que
  `job_runs.last_period` ≠ période courante → générer et enregistrer. Rattrapage au
  démarrage selon la même règle (au plus un bilan par période).
- **Hebdomadaire** (lundi) : semaine précédente — dépenses par catégorie, comparaison avec
  la semaine d'avant, transactions notables, budgets du mois en cours, conseils. 
- **Mensuel** (1er) : mois précédent — revenus, dépenses, taux d'épargne, budgets,
  évolution du patrimoine, objectifs, investissements, 3 conseils.
- Claude rédige avec ses outils (boucle d'outils existante, non streamée). Sans IA : pas de
  bilan (la période est quand même marquée pour éviter des tentatives en boucle ; un
  message court indique comment activer l'IA, une seule fois).

## 8. Telegram

- Variable `TELEGRAM_BOT_TOKEN` (optionnelle) dans `.env` ; `install.sh` la demande
  (facultatif) ; `.env.example` et README expliquent la création via @BotFather.
- **Long polling** `getUpdates` (timeout 30 s) dans une boucle avec reprise exponentielle
  en cas d'erreur ; `offset` conservé en mémoire. Pas de webhook, pas de HTTPS requis.
- **Liaison** : Réglages → « Relier Telegram » génère un code à 6 chiffres valable 10 min ;
  l'utilisateur envoie `/start <code>` au bot → `telegram_chat_id` enregistré, confirmation
  envoyée. Tout autre chat reçoit « Ce bot est privé. » et est ignoré. « Délier » dans
  Réglages efface l'id.
- **Discussion** : un message texte du chat relié est ajouté au fil (`source: telegram`),
  Claude répond (action « typing » renouvelée toutes les 4 s pendant la génération), la
  réponse est enregistrée et envoyée sur Telegram.
- **Commandes** : `/start <code>`, `/nouveau`, `/bilan` (résumé du mois en cours),
  `/modele` (affiche le modèle actuel et la liste ; `/modele <id>` le change), `/aide`.
- **Diffusion** : tout message assistant proactif (alerte, bilan) et toute réponse à un
  message venu de l'app sont aussi envoyés sur Telegram si relié.
- **Formatage** : conversion du markdown restreint en HTML Telegram (`<b>`, `<i>`,
  `<code>`, listes en « • ») avec échappement ; découpage à 4 000 caractères.
- Le token n'est jamais affiché ni journalisé.

## 9. Choix du modèle

- `GET /api/ai/models` : liste via `client.models.list()` (id + nom d'affichage), mise en
  cache 24 h en mémoire ; liste de secours statique (`claude-opus-5-5`,
  `claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-fable-5-1`) si l'API échoue.
- `PUT /api/settings/model` `{ model }` : enregistre `settings.claude_model` (validé contre
  la liste). `getAi()` lit d'abord `settings.claude_model`, puis `CLAUDE_MODEL`, puis la
  valeur par défaut.
- Menu déroulant dans l'en-tête du panneau de chat et dans Réglages > Assistant IA ;
  `/modele` sur Telegram.
- Les paramètres spécifiques à un modèle (ex. `effort`) ne sont envoyés que si le modèle
  les supporte (liste blanche) pour éviter les erreurs 400 lors d'un changement.

## 10. API (nouvelles routes, toutes protégées)

| Route | Rôle |
|---|---|
| `GET /api/messages?before=<id>&limit=50` | fil paginé (plus récents en dernier) |
| `GET /api/messages/unread` | `{ count, latest: Message[] (≤10) }` |
| `POST /api/messages/read` | `{ ids?: number[], all?: true }` |
| `POST /api/messages/divider` | nouvelle conversation |
| `POST /api/ai/chat` | (modifié) body `{ content }` : enregistre le message utilisateur, stream SSE de la réponse, persiste la réponse ; mêmes événements SSE qu'aujourd'hui + `{"type":"saved","id"}` |
| `GET /api/ai/models`, `PUT /api/settings/model` | modèles |
| `GET/PUT /api/settings/alerts`, `GET/PUT /api/settings/digests` | préférences |
| `POST /api/telegram/link` → `{ code, expiresAt }` ; `DELETE /api/telegram/link` ; `GET /api/telegram/status` → `{ configured, linked }` | Telegram |

## 11. Robustesse & tests

- Règles d'alerte, calcul des périodes (semaine ISO, rattrapage), construction du contexte,
  conversion markdown → HTML Telegram, découpage, dédup : fonctions pures testées (vitest).
- Planificateur et bot testés avec horloge et client HTTP injectés (pas de réseau).
- Toute erreur d'un job ou du bot est journalisée sans faire tomber le serveur ; le bot
  redémarre sa boucle.
- Sans `TELEGRAM_BOT_TOKEN` : le bot ne démarre pas ; Réglages l'explique.

## 12. Hors périmètre

Web Push / PWA, plusieurs utilisateurs Telegram, commandes Telegram modifiant les données,
messages vocaux/images, analyse automatique après import, modification des données par
l'IA, notifications par e-mail.
