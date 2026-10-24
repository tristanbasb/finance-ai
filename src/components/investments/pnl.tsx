import { ArrowDownRight, ArrowUpRight, CircleDot, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { formatPercent, NARROW_NBSP } from "@/lib/format";
import { formatEUR } from "@/lib/money";
import type { PriceSource } from "./types";

/**
 * Plus ou moins-value. Le signe (+ / −) et la flèche portent l'information en plus de la couleur
 * (vert / rouge), qui ne doit jamais être le seul indice.
 */
export function Pnl({
  pnl,
  pct,
  showPct = true,
  stacked = false,
  className,
}: {
  /** Plus-value en centimes (signée). */
  pnl: number;
  /** Rendement en fraction. */
  pct: number;
  showPct?: boolean;
  /** Rendement sous le montant (colonne d’un tableau) au lieu de la même ligne. */
  stacked?: boolean;
  className?: string;
}) {
  const sign = pnl > 0 ? "+" : pnl < 0 ? "−" : "";
  const Icon = pnl > 0 ? ArrowUpRight : pnl < 0 ? ArrowDownRight : Minus;
  const pctSign = pct > 0 && pnl > 0 ? "+" : pct < 0 && pnl < 0 ? "−" : "";
  const amount = (
    <span className="inline-flex items-center gap-1">
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <span>
        {sign}
        {sign && NARROW_NBSP}
        {formatEUR(Math.abs(pnl))}
      </span>
    </span>
  );
  const rate = showPct && (
    <span className={stacked ? "text-[12px] opacity-90" : "opacity-90"}>
      ({pctSign}
      {pctSign && NARROW_NBSP}
      {formatPercent(Math.abs(pct))})
    </span>
  );
  return (
    <span
      className={cn(
        "num whitespace-nowrap",
        stacked ? "inline-flex flex-col items-end gap-0.5" : "inline-flex items-center gap-1",
        pnl > 0 ? "text-positive" : pnl < 0 ? "text-danger" : "text-muted",
        className,
      )}
    >
      {amount}
      {rate}
    </span>
  );
}

const SOURCES: Record<PriceSource, { label: string; title: string; variant: "positive" | "neutral" | "accent" | "warning" }> =
  {
    live: { label: "Live", title: "Cours récupéré il y a moins de 15 minutes", variant: "positive" },
    cache: { label: "Cache", title: "Dernier cours connu (plus de 15 minutes)", variant: "neutral" },
    manual: { label: "Manuel", title: "Prix saisi à la main", variant: "accent" },
    cost: { label: "PRU", title: "Aucun cours disponible : le prix de revient est utilisé", variant: "warning" },
  };

/** Pastille indiquant d'où vient le prix unitaire. */
export function PriceSourceBadge({ source }: { source: PriceSource }) {
  const s = SOURCES[source];
  return (
    <Badge variant={s.variant} title={s.title}>
      {source === "live" && <CircleDot aria-hidden />}
      {s.label}
    </Badge>
  );
}
