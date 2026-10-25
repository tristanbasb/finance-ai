import { cn } from "@/lib/cn";

export type ProgressLevel = "ok" | "warn" | "over";

const fills: Record<ProgressLevel, string> = {
  ok: "bg-brand-gradient",
  warn: "bg-warning-fill",
  over: "bg-danger",
};

const tracks: Record<ProgressLevel, string> = {
  ok: "bg-brand-soft",
  warn: "bg-warning-soft",
  over: "bg-danger-soft",
};

export type ProgressProps = {
  /** Avancement entre 0 et 1 (au-delà, la barre est pleine). */
  value: number;
  level?: ProgressLevel;
  /** Nom accessible (ex. « Budget Alimentation »). */
  label: string;
  /** Texte lu par les lecteurs d'écran (ex. « 82 % du budget »). */
  valueText?: string;
  /** Couleur propre (#rrggbb) : remplace celle du niveau, la piste en est une teinte claire. */
  color?: string;
  className?: string;
};

/** Barre de progression fine ; la piste prend une teinte claire de la même couleur. */
export function Progress({ value, level = "ok", label, valueText, color, className }: ProgressProps) {
  const pct = Math.round(Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), 1) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={valueText}
      className={cn("h-2 w-full overflow-hidden rounded-full", !color && tracks[level], className)}
      style={color ? { backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)` } : undefined}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-500 ease-out", !color && fills[level])}
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  );
}
