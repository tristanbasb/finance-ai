// Textes et saisies de la prévision de fin de mois (Budgets, Accueil).
// Module pur : utilisable côté client (pas d'accès à la base).
import type { RecurringStatus } from "@/lib/forecast";
import { formatEUR, MAX_CENTS, parseAmount } from "@/lib/money";

/** Réponse de `canAfford` : reste après l'achat et montant manquant pour garder la marge. */
export type Afford = { ok: boolean; remaining: number; missing: number };

/** Phrase de réponse à « Puis-je acheter… ? » (textes de la spec, marge en centimes). */
export function affordMessage(afford: Afford, margin: number): { tone: "ok" | "ko"; text: string } {
  if (afford.ok) {
    const text = `Oui, il vous resterait ${formatEUR(afford.remaining)}`;
    return { tone: "ok", text: margin > 0 ? `${text} (marge de ${formatEUR(margin)} respectée)` : text };
  }
  return {
    tone: "ko",
    text:
      margin > 0
        ? `Il manquerait ${formatEUR(afford.missing)} pour garder votre marge de ${formatEUR(margin)}`
        : `Il manquerait ${formatEUR(afford.missing)} pour finir le mois sans découvert`,
  };
}

/** Montant saisi strictement positif, en centimes, ou message d'erreur en français. */
export function parsePositiveAmount(raw: string): { ok: true; cents: number } | { ok: false; error: string } {
  if (raw.trim() === "") return { ok: false, error: "Indiquez un montant." };
  const cents = parseAmount(raw);
  if (cents === null) return { ok: false, error: "Montant illisible. Exemple : 49,90." };
  if (cents <= 0) return { ok: false, error: "Le montant doit être supérieur à zéro." };
  if (cents > MAX_CENTS) return { ok: false, error: "Montant trop élevé." };
  return { ok: true, cents };
}

export const RECURRING_STATUS_LABELS: Record<RecurringStatus, string> = {
  due: "À payer",
  paid: "Payée",
  skipped: "Passée",
};

/** Pourquoi une récurrente à payer n'entre pas dans la prévision (compte non courant ou archivé). */
export function outOfForecastHint(account: { type: string; archived: boolean } | undefined): string {
  if (account?.archived) return "Hors prévision (compte archivé)";
  if (account?.type === "savings") return "Hors prévision (compte d'épargne)";
  return "Hors prévision (pas un compte courant)";
}
