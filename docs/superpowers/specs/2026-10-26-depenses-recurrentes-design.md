# Dépenses récurrentes et prévision de fin de mois — Spécification de conception

Date : 2026-10-26
Statut : approuvée (conversation), en revue écrite

## 1. Objectif

L'utilisateur veut déclarer ses dépenses récurrentes (loyer, abonnements, assurances…), dont il
ne connaît pas forcément la date de passage, les **valider à la main** quand elles passent, voir
une **prévision de fin de mois** et savoir s'il **peut s'acheter** quelque chose.

Décisions de l'utilisateur :

| Sujet | Choix |
|---|---|
| Valider | **Crée l'opération** (montant prérempli, modifiable) et marque la récurrente payée pour le mois |
| Périmètre | **Dépenses seulement** (pas de revenus récurrents) |
| Prévision | **Solde actuel − récurrentes restantes** (dépenses courantes non estimées) |
| Emplacement | **Budgets** (carte et liste) + rappel sur l'**Accueil** ; gestion dans **Réglages** |
| « Puis-je acheter » | Oui si la fin de mois prévue après l'achat reste ≥ **marge réglable (200 € par défaut)** ; aussi via Claude |

### Critères de réussite

1. Une récurrente déclarée apparaît « à payer » dans Budgets pour chaque mois où elle est due.
2. « Valider » crée l'opération (catégorie, compte, libellé de la récurrente ; montant et date
   modifiables) et la passe en « payée » ; supprimer l'opération la remet « à payer ».
3. La fin de mois prévue = solde des comptes courants − récurrentes dues ce mois-ci non payées
   et non passées ; elle s'affiche dans Budgets et sur l'Accueil.
4. « Puis-je acheter 400 € ? » répond oui/non avec le reste ou le manque, dans Budgets et via
   Claude (app et Telegram).

## 2. Données

- Table `recurring` : `id`, `label` (texte), `amount` (centimes > 0, dépense), `categoryId`
  (null, catégorie de dépense, `on delete set null`), `accountId` (`on delete restrict`),
  `frequency` (`monthly` | `quarterly` | `yearly`), `anchorMonth` (1-12, null pour mensuelle :
  mois d'échéance de référence ; trimestrielle = ce mois et tous les 3 mois), `active` (booléen),
  `createdAt`.
- Table `recurring_payments` : `recurringId` (cascade), `period` (`YYYY-MM`), `transactionId`
  (null, **cascade** : supprimer l'opération supprime la ligne, la récurrente redevient due),
  `skipped` (booléen), `createdAt` ; clé primaire (`recurringId`, `period`).
- Réglage `forecast_margin` (centimes, défaut 20 000).
- Comptes de la prévision : comptes **courants** (`checking`) non archivés.

## 3. Calcul (`src/lib/forecast.ts`, fonctions pures + requêtes)

- `isDue(recurring, period)` : mensuelle toujours ; trimestrielle si
  `(mois − anchorMonth) mod 3 = 0` ; annuelle si `mois = anchorMonth`.
- Récurrentes du mois : actives et dues ; statut `paid` (paiement avec opération), `skipped`,
  sinon `due`.
- `forecast` = solde des comptes courants − Σ montants `due` dont le compte est un compte courant
  non archivé. Les récurrentes sur d'autres comptes sont listées mais n'entrent pas dans la
  prévision.
- `canAfford(price)` = `forecast − price ≥ margin` ; renvoie `{ ok, remaining: forecast − price,
  missing: max(0, margin − (forecast − price)) }`.

## 4. Interface

- **Budgets** (en haut, mois courant uniquement) :
  - Carte « Fin de mois » : solde des comptes courants, « − X € de récurrentes à venir »,
    « Fin de mois prévue : Y € » ; champ montant « Puis-je acheter… ? » + bouton
    « Vérifier » → « Oui, il vous resterait Z € (marge de 200 € respectée) » ou « Il manquerait
    W € pour garder votre marge de 200 € ».
  - Liste « Récurrentes du mois » : libellé, catégorie, montant, statut ; à payer → boutons
    « Valider » (dialogue : montant, date = aujourd'hui, compte ; crée l'opération) et
    « Passer ce mois » ; payée/passée → « Annuler » (supprime l'opération créée, ou la ligne
    passée). Lien « Gérer » vers Réglages.
  - Rien de récurrent déclaré : carte avec invitation « Déclarez vos dépenses récurrentes » →
    Réglages.
- **Accueil** : dans « Ce mois-ci », ligne « Fin de mois prévue : Y € » (+ « dont X € de
  récurrentes à venir ») ; masquée si aucune récurrente.
- **Réglages** : section « Dépenses récurrentes » (liste, ajout/modification/pause/suppression
  dans un dialogue : libellé, montant, catégorie de dépense, compte, fréquence, mois de
  référence si non mensuelle) et champ « Marge de sécurité ».
- Aucun emoji ; « vous » ; boutons réels avec icônes lucide ; 375/1440 px, clair/sombre.

## 5. API

- `GET/POST /api/recurring`, `PATCH/DELETE /api/recurring/[id]` (zod).
- `POST /api/recurring/[id]/pay` `{ period, amount, date, accountId }` → crée l'opération et la
  ligne de paiement dans une transaction ; 409 si déjà payée/passée pour la période.
- `POST /api/recurring/[id]/skip` `{ period }` ; `DELETE /api/recurring/[id]/payments/[period]`
  (annule : supprime l'opération créée le cas échéant, puis la ligne).
- `GET /api/forecast?price=` → prévision et réponse « puis-je acheter ».
- `GET/PUT /api/settings/forecast-margin` `{ margin }` (centimes ≥ 0).
- Les alertes existantes (budget, dépense inhabituelle) se déclenchent pour l'opération créée
  comme pour une opération saisie (`scheduleAlertChecks`, même portée que la création).

## 6. Claude

- Outil de lecture `get_forecast { price?: number (euros) }` → solde des comptes courants,
  récurrentes restantes (libellé, montant), fin de mois prévue, marge, et si `price` :
  `can_afford`, `remaining`, `missing`. Rappel dans la description : prévision hors dépenses
  courantes (optimiste).
- Pas d'outil d'écriture sur les récurrentes (gestion dans l'app).

## 7. Tests

- `isDue` (mensuelle, trimestrielle, annuelle, pause), prévision (payée, passée, autre compte,
  compte archivé), `canAfford` (oui, non, marge 0).
- Routes : payer (crée l'opération, 409 en double), passer, annuler, suppression de l'opération
  → redevient due, validation des entrées.
- Outil `get_forecast`.
- Interface : vérification navigateur.

## 8. Hors périmètre

Revenus récurrents, détection automatique, rappels de récurrentes non validées, estimation des
dépenses courantes, prévision des mois suivants, outils d'écriture de Claude pour les
récurrentes.
