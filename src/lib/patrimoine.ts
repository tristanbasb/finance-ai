/** Rubriques de la page Patrimoine : identifiant d'ancre et libellé. */
export const PATRIMOINE_SECTIONS = [
  { id: "comptes", label: "Comptes" },
  { id: "objectifs", label: "Objectifs" },
  { id: "investissements", label: "Investissements" },
  { id: "actualites", label: "Actualités" },
] as const;

export type PatrimoineSectionId = (typeof PATRIMOINE_SECTIONS)[number]["id"];

/** Rubriques affichées : Actualités seulement si sa section l'est (au moins une position cotée). */
export function patrimoineSections({ news }: { news: boolean }): (typeof PATRIMOINE_SECTIONS)[number][] {
  return PATRIMOINE_SECTIONS.filter((s) => news || s.id !== "actualites");
}

/** Alias d'ancres acceptés (ancien nom de la rubrique Épargne). */
const ALIASES: Record<string, PatrimoineSectionId> = { epargne: "comptes" };

/** Rubrique désignée par un identifiant (avec ou sans « # ») ou un alias ; `null` si inconnue. */
export function parseSection(value: string | null | undefined): PatrimoineSectionId | null {
  if (!value) return null;
  const id = value.replace(/^#/, "").toLowerCase();
  if (Object.hasOwn(ALIASES, id)) return ALIASES[id];
  return PATRIMOINE_SECTIONS.find((s) => s.id === id)?.id ?? null;
}

/**
 * Rubrique de Patrimoine correspondant à un ancien chemin (`/savings`, `/investments`).
 * `null` pour tout autre chemin.
 */
export function sectionFor(pathname: string): PatrimoineSectionId | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/savings") return "comptes";
  if (path === "/investments") return "investissements";
  return null;
}

/** Destination d'une redirection depuis un ancien chemin (paramètre `section`, le hash se perdant au redirect). */
export function redirectTargetFor(pathname: string): string | null {
  const section = sectionFor(pathname);
  return section ? `/patrimoine?section=${section}` : null;
}
