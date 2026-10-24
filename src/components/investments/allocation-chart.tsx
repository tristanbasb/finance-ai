"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { formatPercent } from "@/lib/format";
import { formatEUR } from "@/lib/money";

export type AllocationSlice = {
  /** Clé stable (type d'actif). */
  key: string;
  name: string;
  /** Couleur de la part (#rrggbb). */
  color: string;
  /** Valeur en centimes positifs. */
  value: number;
};

const R = 42;
const STROKE = 11;
const C = 2 * Math.PI * R;
/** Espace (unités du viewBox ≈ 2 px à l'écran) entre deux parts. */
const GAP = 1.1;

/** Anneau de répartition du patrimoine investi par type d'actif ; la légende porte toutes les valeurs. */
export function AllocationChart({ slices }: { slices: AllocationSlice[] }) {
  const data = [...slices].filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  const total = data.reduce((sum, s) => sum + s.value, 0);
  const [active, setActive] = useState<string | null>(null);
  const activeSlice = data.find((s) => s.key === active) ?? null;

  if (data.length === 0) return null;

  const gap = data.length > 1 ? GAP : 0;
  const arcs = data.map((s, i) => {
    const before = data.slice(0, i).reduce((sum, p) => sum + p.value, 0);
    const length = (s.value / total) * C;
    return { ...s, dash: Math.max(length - gap, 0.4), offset: (before / total) * C };
  });
  const summary = data.map((s) => `${s.name} ${formatPercent(s.value / total)}`).join(", ");

  return (
    <div className="@container">
      <div className="flex flex-col items-center gap-6 @md:flex-row">
        <div className="relative size-40 shrink-0">
          <svg
            viewBox="0 0 100 100"
            role="img"
            aria-label={`Répartition par type d'actif : ${summary}`}
            className="size-full -rotate-90"
            onPointerLeave={() => setActive(null)}
          >
            <circle cx="50" cy="50" r={R} fill="none" stroke="var(--surface-2)" strokeWidth={STROKE} />
            {arcs.map((a) => (
              <circle
                key={a.key}
                cx="50"
                cy="50"
                r={R}
                fill="none"
                stroke={a.color}
                strokeWidth={active === a.key ? STROKE + 2 : STROKE}
                strokeDasharray={`${a.dash} ${C - a.dash}`}
                strokeDashoffset={-a.offset}
                className="cursor-default transition-[opacity,stroke-width] duration-150"
                style={{ opacity: active && active !== a.key ? 0.3 : 1 }}
                onPointerEnter={() => setActive(a.key)}
              />
            ))}
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="num text-[17px] font-semibold tracking-[-0.02em] text-fg">
              {activeSlice ? formatPercent(activeSlice.value / total) : formatEUR(total)}
            </span>
            <span className="max-w-[7.5rem] truncate text-[12px] text-muted">
              {activeSlice ? activeSlice.name : "investis"}
            </span>
          </div>
        </div>

        <ul className="w-full min-w-0 flex-1 space-y-0.5" onPointerLeave={() => setActive(null)}>
          {data.map((s) => (
            <li
              key={s.key}
              onPointerEnter={() => setActive(s.key)}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] transition-colors",
                active === s.key && "bg-surface-2",
              )}
            >
              <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: s.color }} />
              <span className="min-w-0 flex-1 truncate text-fg">{s.name}</span>
              <span className="num w-11 shrink-0 text-right text-subtle">{formatPercent(s.value / total)}</span>
              <span className="num min-w-[4.5rem] shrink-0 text-right font-medium text-fg">{formatEUR(s.value)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
