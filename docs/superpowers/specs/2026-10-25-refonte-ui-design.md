# Refonte de l'interface (UI/UX) — Spécification de conception

Date : 2026-10-25
Statut : approuvée (conversation + maquettes dans le compagnon visuel), en revue écrite
S'appuie sur : `2026-10-24-finance-ai-design.md`, `2026-10-25-assistant-proactif-design.md`

## 1. Objectif

L'utilisateur trouve l'interface « pas belle et pas ergonomique ». Problèmes retenus :
**style visuel**, **navigation et parcours**, **usage sur téléphone** (la densité
d'information n'est pas en cause).

Décisions prises avec l'utilisateur (maquettes) :

| Sujet | Choix |
|---|---|
| Style | **C — coloré & chaleureux** (esprit Lydia / Monzo) |
| Navigation mobile | **A — 4 onglets + gros bouton « + » central**, Claude en bulle flottante |
| Saisie rapide (« + ») | **B — phrase libre analysée par Claude**, formulaire simple en repli |
| Ordinateur | **A — barre latérale à gauche + fil Claude ouvert dans une colonne à droite** |

### Critères de réussite

1. Ajouter une dépense depuis n'importe quelle page en ≤ 2 interactions + la saisie
   (« + » → phrase → « Ajouter »).
2. Sur téléphone (375 px), aucune action principale ne demande de zoomer ; cibles tactiles
   ≥ 44 px ; pas de défilement horizontal.
3. 4 sections principales au lieu de 6 ; tout ce qui existait reste accessible.
4. Un utilisateur sans clé API peut tout faire (repli formulaire, bulle Claude explicative).
5. Aucune régression fonctionnelle : les 468 tests existants passent, toutes les API
   restent compatibles.

## 2. Système visuel (style C)

- **Fond** : blanc / gris très clair (`#f8fafc` pour le fond de page, `#ffffff` pour les
  cartes). **Variante sombre** conservée (préférence système) : fond indigo très profond
  (`#0f1023`), cartes `#181a33`, même dégradé.
- **Signature** : dégradé `#4f46e5 → #9333ea` (indigo → violet) pour la carte « héros »
  (patrimoine), le bouton « + », le bouton primaire et l'état actif de la navigation.
- **Pastels par catégorie** : chaque catégorie garde sa couleur (`categories.color`) ;
  l'UI en dérive un fond pastel (couleur à ~15 % d'opacité) et un texte foncé lisible
  (contraste AA vérifié). L'icône lucide existante est posée dans une pastille ronde.
  Pas d'emoji dans les données.
- **Formes** : rayons 16 px (cartes), 24 px (carte héros, feuilles), boutons pleins
  arrondis ; ombres douces teintées indigo ; bordures quasi invisibles.
- **Typographie** : Geist (déjà chargée), chiffres tabulaires ; montants héros en 800.
- **Ton** : accueil personnalisé (« Bonjour » + moment de la journée), micro-textes
  chaleureux, mais sobres (pas d'emoji dans l'UI sauf le 👋 du bonjour).
- Tous les tokens sont des variables CSS dans `globals.css` (`@theme`), utilisées par les
  primitives `src/components/ui/*` qui sont restylées (pas de nouvelle dépendance).

## 3. Architecture de navigation

Sections : **Accueil** `/`, **Activité** `/transactions` (URL conservée), **Patrimoine**
`/patrimoine` (nouveau, fusionne `/savings` et `/investments`, qui redirigent vers
`/patrimoine#epargne` et `/patrimoine#investissements`), **Budgets** `/budgets` (nouveau).
`/assistant` (plein écran du fil) et `/settings` restent, hors navigation principale.

### Téléphone (< 768 px)
- **En-tête** compact : salutation ou titre de page, cloche (non-lus), avatar → menu
  (Réglages, Assistant plein écran, Déconnexion).
- **Barre du bas** : Accueil · Activité · **[ + ]** · Patrimoine · Budgets. Le « + » est
  un bouton rond en dégradé, surélevé, au centre. Respect de `safe-area-inset-bottom`.
- **Bulle Claude** flottante au-dessus de la barre (à droite), pastille de non-lus ;
  ouvre le fil en plein écran.

### Ordinateur
- **≥ 1280 px** : barre latérale gauche (logo, « + Ajouter » en dégradé, 4 sections,
  Réglages en bas, avatar/déconnexion) · contenu · **colonne Claude à droite** (≈ 360 px,
  fil complet + saisie), repliable (état mémorisé en `localStorage`) ; repliée → bulle.
- **768–1279 px** : barre latérale gauche ; Claude en bulle + panneau latéral (existant).
- La cloche est dans l'en-tête de la colonne de contenu (ordinateur) ou de la page (mobile).

## 4. Pages

### Accueil `/`
1. Salutation + date.
2. **Carte héros** en dégradé : patrimoine net, variation (période des instantanés),
   mini-courbe blanche ; liquidités / investissements en sous-ligne.
3. **Dernier message de Claude** (alerte ou bilan) en carte teintée, « Ouvrir » → fil.
4. **Ce mois-ci** : revenus, dépenses, taux d'épargne en 3 pastilles.
5. **Budgets** en rangée horizontale de pastilles colorées (catégorie, consommé / budget,
   barre) → lien `/budgets`.
6. **Dernières opérations** (5) → lien `/transactions`.
La carte « Analyse IA » existante est intégrée à la page Budgets (§4.4).

### Activité `/transactions`
- En-tête : titre, recherche, bouton « Importer un relevé ».
- **Filtres en pastilles** défilables : mois (‹ ›), comptes, catégories (pastilles aux
  couleurs des catégories).
- Totaux du mois en 3 pastilles ; liste groupée par jour, lignes larges (pastille catégorie,
  libellé, catégorie · compte, montant) ; tap → feuille d'édition (formulaire existant
  restylé). Import CSV : assistant existant restylé.

### Patrimoine `/patrimoine`
- Carte récapitulative (total épargne + investissements, plus-value).
- Section **Comptes** (`#epargne`) : cartes de comptes colorées (courant, épargne…).
- Section **Objectifs** : cartes avec progression et « X €/mois ».
- Section **Investissements** (`#investissements`) : répartition (donut) + positions
  (cartes sur mobile, tableau sur ordinateur), « Actualiser les cours ».
- Les dialogues existants (compte, objectif, position) sont réutilisés et restylés.

### Budgets `/budgets`
- Mois courant (‹ › pour naviguer) ; donut des dépenses par catégorie + légende.
- **Liste des catégories de dépense** : pastille, dépensé, budget, barre (ok / attention /
  dépassé) ; **budget modifiable sur place** (tap sur le montant → champ, Entrée pour
  enregistrer, via `PATCH /api/categories/[id]` `monthlyBudget`).
- Carte « Analyse IA du mois » (existante).
- La gestion complète des catégories (créer, renommer, couleur, icône) reste dans Réglages.

### Réglages `/settings`
Contenu inchangé, présentation alignée sur le nouveau style (sections en cartes,
sommaire d'ancres en haut sur mobile).

### Connexion `/login`
Fond dégradé doux, carte blanche centrée, logo ; logique inchangée.

## 5. Saisie rapide « + » en phrase libre

- Ouvre une **feuille** depuis le bas (mobile) ou une **fenêtre** (ordinateur), focus dans
  le champ. Raccourci clavier `N` conservé (ouvre cette feuille).
- **Mode phrase** (par défaut si l'IA est active) : champ « Écris comme tu parles » +
  exemples. Après saisie (bouton « Analyser » ou Entrée), appel
  `POST /api/ai/parse-transaction` `{ text }` → proposition affichée en champs éditables
  (montant, dépense/revenu, catégorie, libellé, date, compte). « Ajouter » →
  `POST /api/transactions` (déclenche les alertes comme aujourd'hui).
- **Mode formulaire** : bascule « Saisir à la main » ; seul mode si l'IA est désactivée ;
  aussi utilisé en repli si l'analyse échoue (champs pré-remplis avec ce qui a pu être lu).
- Lien « Importer un relevé CSV » en bas de la feuille.
- **Route `POST /api/ai/parse-transaction`** : body `{ text: string (1–500) }` ; Claude
  sans outils, sortie structurée JSON `{ amountCents (int >0), kind ('expense'|'income'),
  categoryId (id de la liste ou null), label (≤ 200), date (YYYY-MM-DD, défaut aujourd'hui,
  « hier » etc. résolus), accountId (id de la liste ou null → compte par défaut) }` ; la
  liste des catégories (id, nom, type) et des comptes non archivés (id, nom, type) est
  fournie dans le prompt, ainsi que la date du jour ; ids hors liste → null ; montant
  invalide → 422 `{ error: "Je n'ai pas trouvé de montant." }` ; IA désactivée → 503
  (message existant). Timeout 30 s. Le texte utilisateur est une donnée, pas une
  instruction. `max_tokens` bas ; `effort` seulement si supporté.
- Compte par défaut : premier compte courant non archivé, sinon premier compte non archivé.

## 6. Composants transverses

- `AppShell` : barre latérale (ordinateur), en-tête + barre du bas (mobile), zone de
  contenu, colonne Claude (≥ 1280 px). Remplace `sidebar.tsx` / `mobile-nav.tsx`.
- `QuickAddProvider` (contexte) : `openQuickAdd()` utilisé par le « + », le raccourci `N`,
  les états vides (« Ajouter une opération »).
- Le fil Claude (`thread.tsx`, `chat.tsx`) est réutilisé dans la colonne de droite, le
  panneau et la page Assistant (déjà factorisé) ; seule la présentation change.
- Primitives `ui/*` restylées (Button, Card, Input, Select, Dialog → devient feuille du bas
  sur mobile, Badge, Progress, Switch, Toast) ; nouvelle primitive `Chip` (pastille de
  filtre / catégorie) et `Sheet` (feuille du bas, réutilise `<dialog>`).

## 7. Accessibilité & qualité

- Contraste AA sur pastels et dégradé (texte blanc sur dégradé ≥ 4,5:1 vérifié).
- Navigation clavier complète, focus visible, `aria-current` sur l'onglet actif,
  feuilles/dialogues avec piège de focus et Échap.
- `prefers-reduced-motion` respecté (animations de feuilles et de cartes).
- Vérification dans le navigateur : 375 px, 768 px, 1280 px, 1440 px, clair et sombre.

## 8. Hors périmètre

Emojis dans les données de catégories, nouvelles fonctionnalités métier, PWA/installation
mobile, refonte du contenu des Réglages, changement des API existantes (hors nouvelle
route d'analyse), personnalisation du thème par l'utilisateur.
