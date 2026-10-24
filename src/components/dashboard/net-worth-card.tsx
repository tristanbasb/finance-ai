import { ArrowDownRight, ArrowUpRight, ChartSpline } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { splitEUR } from "@/components/amount";
import { NetWorthChart, type NetWorthPoint } from "@/components/charts/net-worth-chart";
import { cn } from "@/lib/cn";
import { formatEUR } from "@/lib/money";
import { formatDateShort, formatPercent } from "@/lib/format";

export type NetWorthCardProps = {
  netWorth: number;
  cash: number;
  investments: number;
  /** Snapshots par date croissante. */
  points: NetWorthPoint[];
  className?: string;
};

function Delta({ points }: { points: NetWorthPoint[] }) {
  const first = points[0].netWorth;
  const last = points[points.length - 1].netWorth;
  const change = last - first;
  const up = change >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  const pct = first !== 0 ? ` (${up ? "+" : ""}${formatPercent(change / Math.abs(first))})` : "";
  return (
    <p className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
      <Badge variant={up ? "positive" : "danger"} className="num">
        <Icon aria-hidden />
        {up ? "+" : "−"}
        {formatEUR(Math.abs(change))}
        {pct}
      </Badge>
      <span>depuis le {formatDateShort(points[0].date)}</span>
    </p>
  );
}

/** Carte maîtresse : patrimoine net (chiffre héros), répartition et courbe des snapshots. */
export function NetWorthCard({ netWorth, cash, investments, points, className }: NetWorthCardProps) {
  const { whole, rest } = splitEUR(netWorth);
  const hasCurve = points.length >= 2;

  return (
    <Card className={cn("flex flex-col overflow-hidden", className)}>
      <div className="space-y-3 px-5 pt-5 sm:px-6 sm:pt-6">
        <h2 className="text-[13px] font-medium text-muted">Patrimoine net</h2>
        <p className="text-[40px] font-semibold leading-none tracking-[-0.035em] text-fg sm:text-[52px]">
          {whole}
          <span className="text-[0.5em] font-medium tracking-[-0.01em] text-subtle">{rest}</span>
        </p>
        {hasCurve && <Delta points={points} />}
        <dl className="flex flex-wrap gap-x-6 gap-y-1 pt-1 text-[13px]">
          <div className="flex items-center gap-2">
            <dt className="text-muted">Liquidités</dt>
            <dd className="num font-medium text-fg">{formatEUR(cash)}</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="text-muted">Investissements</dt>
            <dd className="num font-medium text-fg">{formatEUR(investments)}</dd>
          </div>
        </dl>
      </div>

      <div className="mt-auto px-2 pb-3 pt-6 sm:px-3">
        {hasCurve ? (
          <NetWorthChart points={points} />
        ) : (
          <div className="mx-3 mb-3 flex h-[180px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-6 text-center">
            <ChartSpline aria-hidden className="size-5 text-subtle" />
            <p className="text-sm font-medium text-fg">Votre courbe se dessine au fil des jours</p>
            <p className="max-w-xs text-[13px] text-muted">
              Un point est enregistré chaque jour où vous ouvrez le tableau de bord.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
