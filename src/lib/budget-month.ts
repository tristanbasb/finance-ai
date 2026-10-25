import { budgetStatus } from "@/lib/finance";

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Mois « YYYY-MM » valide du paramètre d'adresse, sinon `fallback`. */
export function parseMonthParam(raw: string | string[] | undefined, fallback: string): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && MONTH.test(value) ? value : fallback;
}

/** Décale un mois « YYYY-MM » de `delta` mois. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export type BudgetRowData = {
  id: number;
  name: string;
  color: string;
  icon: string;
  /** Budget mensuel en centimes, ou null. */
  budget: number | null;
  /** Dépensé dans le mois, en centimes positifs. */
  spent: number;
};

const LEVEL_RANK = { over: 0, warn: 1, ok: 2 } as const;

/** Dépassés d'abord, puis par part consommée décroissante ; sans budget en dernier, par dépense décroissante. */
export function sortBudgetRows<T extends BudgetRowData>(rows: readonly T[]): T[] {
  const key = (r: T) => {
    const s = budgetStatus(r.spent, r.budget);
    return s ? { has: 0, rank: LEVEL_RANK[s.level], pct: s.pct } : { has: 1, rank: 3, pct: 0 };
  };
  return [...rows].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return (
      ka.has - kb.has ||
      (ka.has === 0 ? ka.rank - kb.rank || kb.pct - ka.pct : 0) ||
      b.spent - a.spent ||
      a.name.localeCompare(b.name, "fr")
    );
  });
}
