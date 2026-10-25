import { formatEUR } from "@/lib/money";
import { formatPercent } from "@/lib/format";

// Règles d'alerte pures : elles reçoivent des données prêtes à l'emploi (construites par le
// moteur depuis la base) et renvoient des alertes dédupliquées par `key`. Aucun accès base ici.

export type AlertType = "budget80" | "budget100" | "expense" | "price" | "goal";

export type Alert = {
  /** Clé de déduplication (spec §6). */
  key: string;
  type: AlertType;
  /** Chiffres déjà formatés pour l'affichage (« 412,30 € », « 92 % »). */
  facts: Record<string, string | number>;
  /** Autres clés à réclamer avec celle-ci (ex. le seuil 80 % quand on saute directement à 100 %). */
  extraKeys?: string[];
};

export type BudgetLineInput = { categoryId: number; name: string; budget: number; spent: number };

/** Seuils 80 % / 100 % : seul le plus haut non réclamé est émis. `claimed` = clés déjà journalisées. */
export function budgetAlerts(input: { month: string; lines: BudgetLineInput[]; claimed: ReadonlySet<string> }): Alert[] {
  const out: Alert[] = [];
  for (const l of input.lines) {
    if (l.budget <= 0) continue;
    const key80 = `budget:${l.categoryId}:${input.month}:80`;
    const key100 = `budget:${l.categoryId}:${input.month}:100`;
    const pct = l.spent / l.budget;
    const facts = {
      category: l.name,
      spent: formatEUR(l.spent),
      budget: formatEUR(l.budget),
      pct: formatPercent(pct),
      month: input.month,
    };
    if (l.spent > l.budget) {
      if (!input.claimed.has(key100)) out.push({ key: key100, type: "budget100", facts, extraKeys: [key80] });
    } else if (pct >= 0.8 && !input.claimed.has(key80) && !input.claimed.has(key100)) {
      out.push({ key: key80, type: "budget80", facts });
    }
  }
  return out;
}

export type ExpenseInput = {
  id: number;
  label: string;
  categoryName: string;
  /** Montant de la dépense, en centimes positifs. */
  amount: number;
  /** Médiane (centimes positifs) des dépenses de la catégorie sur 90 jours, null sans échantillon. */
  median: number | null;
  samples: number;
};

export const MIN_SAMPLES = 5;

/** Dépense ≥ seuil ET ≥ 3 × médiane (si ≥ 5 échantillons) ; sinon seuil × 2. */
export function unusualExpense(input: { transactions: ExpenseInput[]; minCents: number }): Alert[] {
  const out: Alert[] = [];
  for (const t of input.transactions) {
    const enough = t.samples >= MIN_SAMPLES && t.median !== null;
    const unusual = enough
      ? t.amount >= input.minCents && t.amount >= 3 * (t.median as number)
      : t.amount >= 2 * input.minCents;
    if (!unusual) continue;
    const facts: Alert["facts"] = { label: t.label, category: t.categoryName, amount: formatEUR(t.amount) };
    if (enough) facts.median = formatEUR(Math.round(t.median as number));
    out.push({ key: `expense:${t.id}`, type: "expense", facts });
  }
  return out;
}

export type PriceMoveInput = {
  symbol: string;
  name: string;
  /** Variation du jour en pourcentage (6,2 pour +6,2 %). */
  changePct: number;
  /** Cours unitaire et valeur de la position, en centimes. */
  priceCents: number;
  valueCents: number;
};

const pctFormatter = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

export function priceMoveAlerts(input: { moves: PriceMoveInput[]; thresholdPct: number; date: string }): Alert[] {
  const out: Alert[] = [];
  for (const m of input.moves) {
    if (!Number.isFinite(m.changePct) || Math.abs(m.changePct) < input.thresholdPct) continue;
    const dir = m.changePct > 0 ? "up" : "down";
    out.push({
      key: `price:${m.symbol}:${input.date}:${dir}`,
      type: "price",
      facts: {
        name: m.name,
        symbol: m.symbol,
        changePct: `${m.changePct > 0 ? "+" : ""}${pctFormatter.format(m.changePct)} %`,
        price: formatEUR(Math.round(m.priceCents)),
        value: formatEUR(Math.round(m.valueCents)),
      },
    });
  }
  return out;
}

export type GoalInput = { id: number; name: string; target: number; current: number; pct: number };

export function goalReachedAlerts(input: { goals: GoalInput[] }): Alert[] {
  return input.goals
    .filter((g) => g.pct >= 1)
    .map((g) => ({
      key: `goal:${g.id}`,
      type: "goal" as const,
      facts: { name: g.name, target: formatEUR(g.target), current: formatEUR(g.current) },
    }));
}
