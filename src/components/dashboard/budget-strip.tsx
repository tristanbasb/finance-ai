import Link from "next/link";
import { ArrowRight, CircleAlert, Target, type LucideIcon } from "lucide-react";
import { categoryIconComponent } from "@/components/category-icon";
import { buttonClasses } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { tintStyle } from "@/lib/category-tint";
import { formatPercent } from "@/lib/format";
import { formatEUR } from "@/lib/money";
import type { BudgetLine } from "@/lib/queries/overview";

function BudgetTile({ line, icon: Icon }: { line: BudgetLine; icon: LucideIcon }) {
  const { level, pct } = line.status;
  const remaining = line.budget - line.spent;
  return (
    <li className="tint flex w-44 shrink-0 snap-start flex-col gap-3 rounded-card p-4" style={tintStyle(line.color)}>
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-surface/70"
        >
          <Icon className="size-3.5" />
        </span>
        <h3 className="min-w-0 truncate text-[13px] font-semibold">{line.name}</h3>
      </div>
      <p className="num">
        <span className="block text-lg font-bold leading-tight tracking-[-0.02em]">{formatEUR(line.spent)}</span>
        <span className="block text-[12px] font-medium">sur {formatEUR(line.budget)}</span>
      </p>
      <div className="space-y-1.5">
        <Progress
          value={pct}
          level={level}
          label={`Budget ${line.name}`}
          valueText={`${formatPercent(pct)} du budget utilisé`}
        />
        <p className="num flex items-center gap-1 text-[12px] font-medium">
          {level === "over" && <CircleAlert aria-hidden className="size-3.5 shrink-0" />}
          {remaining < 0 ? `Dépassé de ${formatEUR(-remaining)}` : `Reste ${formatEUR(remaining)}`}
        </p>
      </div>
    </li>
  );
}

/** « Budgets » de l'accueil : une rangée défilable de pastilles colorées, une par catégorie budgétée. */
export function BudgetStrip({ budgets, className }: { budgets: BudgetLine[]; className?: string }) {
  return (
    <section aria-labelledby="home-budgets-title" className={className}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="home-budgets-title" className="text-[17px] font-bold tracking-[-0.02em] text-fg">
          Budgets
        </h2>
        {budgets.length > 0 && (
          <Link
            href="/budgets"
            className={buttonClasses({
              variant: "ghost",
              size: "sm",
              className: "-mr-2",
            })}
          >
            Tout voir
            <ArrowRight aria-hidden />
          </Link>
        )}
      </div>
      {budgets.length === 0 ? (
        <div className="flex flex-col gap-3 rounded-card border border-dashed border-border-strong/70 bg-surface-2/50 p-4 sm:flex-row sm:items-center">
          <span
            aria-hidden
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand"
          >
            <Target className="size-5" />
          </span>
          <p className="min-w-0 flex-1 text-[13px] text-muted">
            Fixez un plafond mensuel par catégorie pour voir ici ce qu&apos;il vous reste à dépenser.
          </p>
          <Link
            href="/budgets"
            className={buttonClasses({
              variant: "secondary",
              size: "sm",
              className: "self-start sm:self-auto",
            })}
          >
            <Target aria-hidden />
            Définir un budget
          </Link>
        </div>
      ) : (
        <div
          role="region"
          aria-label="Budgets du mois, défilement horizontal"
          tabIndex={0}
          className="-mx-4 overflow-x-auto px-4 pb-2 [scrollbar-width:thin] scroll-px-4 sm:-mx-6 sm:px-6 sm:scroll-px-6 md:mx-0 md:px-0 md:scroll-px-0"
        >
          <ul className="flex snap-x snap-mandatory gap-3">
            {budgets.map((b) => (
              <BudgetTile key={b.categoryId} line={b} icon={categoryIconComponent(b.icon)} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
