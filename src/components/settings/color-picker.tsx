"use client";

import { useId } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

/** Palette proposée pour les comptes. */
export const ACCOUNT_COLORS = [
  "#6366f1",
  "#3b82f6",
  "#06b6d4",
  "#14b8a6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#8b5cf6",
  "#64748b",
] as const;

/** Palette proposée pour les catégories (reprend les couleurs du jeu de départ). */
export const CATEGORY_COLORS = [
  "#22c55e",
  "#16a34a",
  "#84cc16",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
  "#ec4899",
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#94a3b8",
] as const;

/** Sélecteur de couleur en pastilles (radiogroup). Une couleur hors palette est ajoutée à la fin. */
export function ColorPicker({
  value,
  onChange,
  palette,
}: {
  value: string;
  onChange: (c: string) => void;
  palette: readonly string[];
}) {
  const labelId = useId();
  const colors = palette.includes(value) ? palette : [...palette, value];
  return (
    <div className="space-y-1.5">
      <p id={labelId} className="text-[13px] font-medium text-fg">
        Couleur
      </p>
      <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap gap-2.5">
        {colors.map((c, i) => {
          const active = c === value;
          return (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`Couleur ${i + 1}`}
              onClick={() => onChange(c)}
              style={{ backgroundColor: c }}
              className={cn(
                "inline-flex size-8 items-center justify-center rounded-full text-white transition-shadow",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                active && "ring-2 ring-fg ring-offset-2 ring-offset-surface",
              )}
            >
              {active && <Check aria-hidden className="size-4" strokeWidth={3} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
