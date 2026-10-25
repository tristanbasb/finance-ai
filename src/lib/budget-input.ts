import { parseAmount } from "@/lib/money";

/** Plafond d'un budget mensuel (10 millions d'euros), en centimes. */
export const MAX_BUDGET_CENTS = 1_000_000_000;

export type BudgetInputResult = { ok: true; cents: number | null } | { ok: false; error: string };

/**
 * Lit la saisie d'un budget mensuel : vide → `null` (supprimer le budget), sinon un montant
 * strictement positif en centimes entiers (« 1 234,5 » → 123450).
 */
export function parseBudgetInput(raw: string): BudgetInputResult {
  if (raw.trim() === "") return { ok: true, cents: null };
  const cents = parseAmount(raw);
  if (cents === null) return { ok: false, error: "Saisissez un montant, par exemple 450 ou 1 234,50." };
  if (cents < 0) return { ok: false, error: "Le budget ne peut pas être négatif." };
  if (cents === 0) return { ok: false, error: "Le budget doit être supérieur à 0." };
  if (cents > MAX_BUDGET_CENTS) return { ok: false, error: "Ce budget est trop élevé." };
  return { ok: true, cents };
}
