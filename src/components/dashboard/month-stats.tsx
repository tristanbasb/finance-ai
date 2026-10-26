import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, CalendarCheck, ChevronRight, PiggyBank, type LucideIcon } from "lucide-react";
import { Amount } from "@/components/amount";
import { cn } from "@/lib/cn";
import { formatPercent } from "@/lib/format";
import { formatEUR } from "@/lib/money";

function StatTile({
  label,
  icon: Icon,
  value,
  caption,
  tone,
  className,
}: {
  label: string;
  icon: LucideIcon;
  value: ReactNode;
  caption: string;
  tone: "positive" | "neutral" | "brand";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col justify-between gap-3 rounded-card p-4",
        tone === "positive" && "bg-positive-soft",
        tone === "neutral" && "border border-border bg-surface shadow-soft",
        tone === "brand" && "bg-brand-soft",
        className,
      )}
    >
      <dt
        className={cn(
          "flex items-center gap-2 text-[13px] font-semibold",
          tone === "positive" && "text-positive",
          tone === "neutral" && "text-muted",
          tone === "brand" && "text-brand",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "inline-flex size-7 shrink-0 items-center justify-center rounded-full",
            tone === "neutral" ? "bg-surface-2" : "bg-surface/70",
          )}
        >
          <Icon className="size-3.5" />
        </span>
        {label}
      </dt>
      <dd className="space-y-0.5">
        <p className="num text-xl font-bold tracking-[-0.02em] text-fg">{value}</p>
        <p className="text-[12px] text-muted">{caption}</p>
      </dd>
    </div>
  );
}

/** Prévision de fin de mois (centimes) : affichée seulement si au moins une récurrente existe. */
export type MonthForecast = { forecast: number; dueTotal: number; margin: number };

/** « Fin de mois prévue : Y € », lien vers Budgets où se trouvent le détail et les récurrentes. */
function ForecastLine({ forecast, dueTotal, margin }: MonthForecast) {
  const tone = forecast < 0 ? "danger" : forecast < margin ? "warning" : "positive";
  return (
    <Link
      href="/budgets"
      className={cn(
        "group flex items-center gap-3 rounded-card border border-border bg-surface p-4 shadow-soft",
        "transition-colors duration-150 hover:border-border-strong hover:bg-surface-2",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "inline-flex size-9 shrink-0 items-center justify-center rounded-full",
          tone === "positive" && "bg-positive-soft text-positive",
          tone === "warning" && "bg-warning-soft text-warning",
          tone === "danger" && "bg-danger-soft text-danger",
        )}
      >
        <CalendarCheck className="size-4" />
      </span>
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="block text-[13px] font-semibold text-fg">
          Fin de mois prévue : <span className="num whitespace-nowrap text-[15px] font-bold">{formatEUR(forecast)}</span>
        </span>
        <span className="num block text-[12px] text-muted">
          {dueTotal > 0
            ? `dont ${formatEUR(dueTotal)} de récurrentes à venir`
            : "Aucune récurrente encore à payer ce mois-ci"}
        </span>
      </span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-subtle transition-colors group-hover:text-fg" />
    </Link>
  );
}

/**
 * « Ce mois-ci » : revenus, dépenses et taux d'épargne du mois courant, en trois pastilles,
 * puis la fin de mois prévue quand des dépenses récurrentes sont déclarées.
 */
export function MonthStats({
  income,
  expenses,
  savingsRate,
  monthLabel,
  forecast,
  className,
}: {
  income: number;
  /** Négatif ou nul. */
  expenses: number;
  savingsRate: number;
  monthLabel: string;
  forecast?: MonthForecast | null;
  className?: string;
}) {
  const saved = income + expenses;
  return (
    <section aria-labelledby="home-month-title" className={cn("space-y-3", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="home-month-title" className="text-[17px] font-bold tracking-[-0.02em] text-fg">
          Ce mois-ci
        </h2>
        <p className="text-[13px] text-muted first-letter:uppercase">{monthLabel}</p>
      </div>
      <dl className="grid grid-cols-2 gap-3 @lg:grid-cols-3 @2xl:grid-cols-1">
        <StatTile
          tone="positive"
          label="Revenus"
          icon={ArrowDownLeft}
          value={<Amount cents={income} />}
          caption="Entrées depuis le 1er"
        />
        <StatTile
          tone="neutral"
          label="Dépenses"
          icon={ArrowUpRight}
          value={<Amount cents={Math.abs(expenses)} />}
          caption="Sorties depuis le 1er"
        />
        <StatTile
          tone="brand"
          className="col-span-2 @lg:col-span-1"
          label="Taux d'épargne"
          icon={PiggyBank}
          value={income > 0 ? formatPercent(savingsRate) : "—"}
          caption={
            income <= 0
              ? "Aucun revenu ce mois-ci"
              : saved >= 0
                ? `${formatEUR(saved)} mis de côté`
                : `${formatEUR(-saved)} de plus que vos revenus`
          }
        />
      </dl>
      {forecast && <ForecastLine {...forecast} />}
    </section>
  );
}
