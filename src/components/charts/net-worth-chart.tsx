"use client";

import { useId } from "react";
import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { formatEUR } from "@/lib/money";
import { formatDateFull, formatDateShort, formatEURCompact } from "@/lib/format";

export type NetWorthPoint = { date: string; netWorth: number };

function ChartTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  const value = Number(payload[0].value ?? 0);
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 shadow-pop">
      <p className="num text-sm font-semibold text-fg">{formatEUR(value)}</p>
      <p className="text-[12px] text-muted">{formatDateFull(String(label))}</p>
    </div>
  );
}

/** Courbe du patrimoine net (une série, couleur d'accent, lavis à ~10 %). */
export function NetWorthChart({ points, height = 220 }: { points: NetWorthPoint[]; height?: number }) {
  const gradientId = useId().replace(/:/g, "");
  const values = points.map((p) => p.netWorth);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max((max - min) * 0.15, Math.abs(max) * 0.01, 100);

  return (
    <AreaChart
      responsive
      data={points}
      margin={{ top: 8, right: 0, bottom: 0, left: 0 }}
      style={{ width: "100%", height }}
      accessibilityLayer
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.16} />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
        </linearGradient>
      </defs>
      <CartesianGrid vertical={false} stroke="var(--grid)" />
      <XAxis
        dataKey="date"
        tickFormatter={formatDateShort}
        tickLine={false}
        axisLine={false}
        minTickGap={40}
        tickMargin={10}
        tick={{ fill: "var(--fg-subtle)", fontSize: 11 }}
      />
      <YAxis
        orientation="right"
        width={60}
        domain={[Math.floor(min - pad), Math.ceil(max + pad)]}
        tickFormatter={formatEURCompact}
        tickLine={false}
        axisLine={false}
        tickCount={4}
        tick={{ fill: "var(--fg-subtle)", fontSize: 11, className: "num" }}
      />
      <Tooltip
        content={ChartTooltip}
        cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
        isAnimationActive={false}
      />
      <Area
        type="monotone"
        dataKey="netWorth"
        name="Patrimoine net"
        stroke="var(--accent)"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        fill={`url(#${gradientId})`}
        dot={false}
        activeDot={{ r: 4.5, fill: "var(--accent)", stroke: "var(--surface)", strokeWidth: 2 }}
        animationDuration={600}
      />
    </AreaChart>
  );
}
