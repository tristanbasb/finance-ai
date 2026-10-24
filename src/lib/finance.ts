// Calculs financiers purs. Montants et prix en centimes (entiers), dates en YYYY-MM-DD,
// quantités réelles. Aucune dépendance, aucun accès à la base ni à l'horloge.

export function accountBalance(initial: number, txAmounts: number[]): number {
  return txAmounts.reduce((sum, a) => sum + a, initial);
}

/** Valeur d'une position en centimes (arrondie). */
export function holdingValue(h: { quantity: number; price: number }): number {
  return Math.round(h.quantity * h.price);
}

/** Valeur, coût, plus-value et rendement (fraction, 0 si le coût est nul) d'une position. */
export function holdingPnl(h: { quantity: number; avgPrice: number; price: number }): {
  value: number;
  cost: number;
  pnl: number;
  pnlPct: number;
} {
  const value = holdingValue(h);
  const cost = Math.round(h.quantity * h.avgPrice);
  const pnl = value - cost;
  return { value, cost, pnl, pnlPct: cost === 0 ? 0 : pnl / cost };
}

/** Taux d'épargne = (revenus + dépenses) / revenus ; dépenses négatives ; 0 si revenus <= 0. */
export function savingsRate(income: number, expenses: number): number {
  return income <= 0 ? 0 : (income + expenses) / income;
}

/** Mois calendaires entiers entre deux dates YYYY-MM-DD (peut être négatif). */
function wholeMonthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
}

/**
 * Avancement d'un objectif d'épargne. `pct` est borné à [0, 1] ; `monthlyNeeded` =
 * reste à épargner / mois restants (mois entiers, minimum 1, arrondi au centime supérieur),
 * null sans échéance, 0 si l'objectif est atteint.
 */
export function goalProgress(
  g: { target: number; current: number; deadline: string | null },
  today: string,
): { pct: number; remaining: number; monthlyNeeded: number | null } {
  const remaining = Math.max(0, g.target - g.current);
  const pct = g.target <= 0 ? 1 : Math.min(1, Math.max(0, g.current / g.target));
  if (g.deadline === null) return { pct, remaining, monthlyNeeded: null };
  if (remaining === 0) return { pct, remaining, monthlyNeeded: 0 };
  const months = Math.max(1, wholeMonthsBetween(today, g.deadline));
  return { pct, remaining, monthlyNeeded: Math.ceil(remaining / months) };
}

/**
 * Consommation d'un budget (`spent` en valeur positive). `pct` peut dépasser 1.
 * warn à partir de 80 %, over au-delà de 100 %. Budget nul : ok si rien dépensé, sinon over (pct = 1).
 */
export function budgetStatus(
  spent: number,
  budget: number | null,
): { pct: number; level: "ok" | "warn" | "over" } | null {
  if (budget === null) return null;
  if (budget <= 0) return spent > 0 ? { pct: 1, level: "over" } : { pct: 0, level: "ok" };
  const pct = spent / budget;
  return { pct, level: pct > 1 ? "over" : pct >= 0.8 ? "warn" : "ok" };
}

/** Premier et dernier jour d'un mois « YYYY-MM ». */
export function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, "0")}` };
}
