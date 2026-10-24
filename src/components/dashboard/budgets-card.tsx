import Link from "next/link";
import { CircleAlert, Target, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Progress } from "@/components/ui/progress";
import { buttonClasses } from "@/components/ui/button";
import { CategoryIcon } from "@/components/category-icon";
import type { BudgetLine } from "@/lib/queries/overview";
import { formatEUR } from "@/lib/money";
import { formatPercent } from "@/lib/format";

function BudgetRow({ line }: { line: BudgetLine }) {
  const { level, pct } = line.status;
  const remaining = line.budget - line.spent;
  return (
    <li className="space-y-2.5 py-3 first:pt-0 last:pb-0">
      <div className="flex items-center gap-3">
        <CategoryIcon icon={line.icon} color={line.color} size="sm" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{line.name}</span>
        <span className="num text-[13px] text-muted">
          <span className="font-medium text-fg">{formatEUR(line.spent)}</span> / {formatEUR(line.budget)}
        </span>
      </div>
      <Progress
        value={pct}
        level={level}
        label={`Budget ${line.name}`}
        valueText={`${formatPercent(pct)} du budget utilisé`}
      />
      <div className="flex items-center justify-between gap-2 text-[12px]">
        {level === "over" ? (
          <Badge variant="danger">
            <CircleAlert aria-hidden />
            Dépassé de {formatEUR(-remaining)}
          </Badge>
        ) : level === "warn" ? (
          <Badge variant="warning">
            <TriangleAlert aria-hidden />
            Reste {formatEUR(remaining)}
          </Badge>
        ) : (
          <span className="text-muted">Reste {formatEUR(remaining)}</span>
        )}
        <span className="num text-subtle">{formatPercent(pct)}</span>
      </div>
    </li>
  );
}

/** Budgets mensuels des catégories qui en ont un. */
export function BudgetsCard({ budgets, monthLabel }: { budgets: BudgetLine[]; monthLabel: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Budgets</CardTitle>
        <CardDescription className="first-letter:uppercase">{monthLabel}</CardDescription>
      </CardHeader>
      <CardContent>
        {budgets.length === 0 ? (
          <EmptyState
            icon={Target}
            title="Aucun budget défini"
            description="Fixez un plafond mensuel par catégorie pour suivre vos dépenses."
            action={
              <Link href="/settings#categories" className={buttonClasses({ variant: "secondary", size: "sm" })}>
                Définir un budget
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {budgets.map((b) => (
              <BudgetRow key={b.categoryId} line={b} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
