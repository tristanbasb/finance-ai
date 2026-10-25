import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { splitEUR } from "@/components/amount";
import { formatPercent, NARROW_NBSP } from "@/lib/format";
import { formatEUR } from "@/lib/money";

export type PatrimoineHeroProps = {
  /** Patrimoine net (centimes). */
  netWorth: number;
  /** Soldes des comptes courants et autres (hors épargne). */
  liquidities: number;
  /** Soldes des comptes d'épargne. */
  savings: number;
  /** Valeur des positions. */
  investments: number;
  /** Plus ou moins-value latente ; `null` sans position. */
  pnl: { amount: number; pct: number } | null;
};

/** Carte récapitulative en dégradé : patrimoine total, répartition en trois lignes, plus-value. */
export function PatrimoineHero({ netWorth, liquidities, savings, investments, pnl }: PatrimoineHeroProps) {
  const { whole, rest } = splitEUR(netWorth);
  const lines = [
    { label: "Liquidités", value: liquidities },
    { label: "Épargne", value: savings },
    { label: "Investissements", value: investments },
  ];
  const Icon = pnl && pnl.amount > 0 ? ArrowUpRight : pnl && pnl.amount < 0 ? ArrowDownRight : Minus;
  const sign = pnl ? (pnl.amount > 0 ? "+" : pnl.amount < 0 ? "−" : "") : "";

  return (
    <section
      aria-label="Patrimoine total"
      className="relative overflow-hidden rounded-hero bg-brand-gradient p-6 text-white shadow-glow sm:p-8"
    >
      {/* Halos décoratifs. */}
      <span aria-hidden className="pointer-events-none absolute -right-16 -top-20 size-64 rounded-full bg-white/10" />
      <span aria-hidden className="pointer-events-none absolute -bottom-24 right-24 size-56 rounded-full bg-white/[0.07]" />

      <div className="relative space-y-1">
        <p className="text-[13px] font-semibold text-white/85">Patrimoine total</p>
        <p className="num text-[40px] font-semibold leading-none tracking-[-0.035em] sm:text-[56px]">
          {whole}
          <span className="text-[0.5em] font-medium text-white/80">{rest}</span>
        </p>
        {pnl && (
          <p className="num flex flex-wrap items-center gap-x-2 gap-y-1 pt-2 text-[13px] font-medium text-white">
            <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2.5 py-1">
              <Icon aria-hidden className="size-3.5" />
              {sign}
              {sign && NARROW_NBSP}
              {formatEUR(Math.abs(pnl.amount))}
              {pnl.pct !== 0 && ` (${pnl.amount > 0 ? "+" : "−"}${formatPercent(Math.abs(pnl.pct))})`}
            </span>
            <span className="text-white/85">de plus-value sur vos investissements</span>
          </p>
        )}
      </div>

      <dl className="relative mt-6 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {lines.map((l) => (
          <div key={l.label} className="flex items-baseline justify-between gap-3 rounded-card bg-white/15 px-4 py-3 sm:block">
            <dt className="text-[12px] font-medium text-white/85 sm:text-[13px]">{l.label}</dt>
            <dd className="num text-base font-semibold tracking-[-0.02em] sm:mt-0.5 sm:text-lg">{formatEUR(l.value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
