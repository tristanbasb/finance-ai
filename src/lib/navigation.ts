// Logique pure de la navigation (rubrique active, titre de l'en-tête, salutation, colonne Claude).

/** Vrai si `pathname` relève de la rubrique `href` (« / » ne correspond qu'à lui-même). */
export function isActive(pathname: string, rawHref: string): boolean {
  const href = rawHref.split("#")[0];
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Salutation selon l'heure locale : « Bonjour » (5 h–12 h), « Bon après-midi » (12 h–18 h), « Bonsoir ». */
export function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) return "Bonjour";
  if (hour >= 12 && hour < 18) return "Bon après-midi";
  return "Bonsoir";
}

const TITLES: readonly (readonly [string, string])[] = [
  ["/transactions", "Activité"],
  ["/patrimoine", "Patrimoine"],
  ["/budgets", "Budgets"],
  ["/settings", "Réglages"],
  ["/assistant", "Assistant"],
];

/**
 * Titre de l'en-tête de l'application : la salutation sur l'accueil (« Accueil » tant que
 * l'heure locale n'est pas connue, au premier rendu), sinon le nom de la rubrique.
 */
export function headerTitle(pathname: string, hour: number | null): string {
  if (pathname === "/") return hour === null ? "Accueil" : greeting(hour);
  for (const [href, title] of TITLES) if (isActive(pathname, href)) return title;
  return "Finance AI";
}

/** Clé localStorage de l'état replié de la colonne Claude (grand écran). */
export const CLAUDE_COLUMN_KEY = "finance-ai.ui.claude-column";

/**
 * Script exécuté avant l'affichage (mise en page racine) : marque
 * `<html data-claude-column="collapsed">` si la colonne est repliée, pour que la mise en page
 * (CSS) soit juste dès la première image.
 */
export const CLAUDE_COLUMN_BOOT_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(
  CLAUDE_COLUMN_KEY,
)})==="collapsed")document.documentElement.dataset.claudeColumn="collapsed"}catch(e){}`;

/** Valeur stockée → colonne repliée (toute autre valeur, ou rien : dépliée). */
export function isColumnCollapsed(stored: string | null): boolean {
  return stored === "collapsed";
}

/**
 * Requête média de la colonne Claude, partagée à l'identique par le CSS (`globals.css`, vérifié
 * par un test) et par `matchMedia` : CSS et JS basculent toujours ensemble, quelle que soit la
 * taille de police par défaut du navigateur (80rem = 1280 px à 16 px, comme Tailwind `xl`).
 */
export const CLAUDE_COLUMN_MEDIA = "(min-width: 80rem)";

/** La colonne Claude est affichée : grand écran, non repliée, hors page Assistant. */
export function showClaudeColumn({
  wide,
  collapsed,
  pathname,
}: {
  wide: boolean;
  collapsed: boolean;
  pathname: string;
}): boolean {
  return wide && !collapsed && pathname !== "/assistant";
}
