export type ClassValue = string | false | null | undefined | 0;

/** Concatène des classes en ignorant les valeurs falsy (sans fusion des conflits Tailwind). */
export function cn(...classes: ClassValue[]): string {
  return classes.filter(Boolean).join(" ");
}
