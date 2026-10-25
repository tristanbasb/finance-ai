"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type SwitchProps = {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
};

/** Interrupteur accessible (`role="switch"`) avec libellé et aide optionnelle. */
export function Switch({ checked, onChange, label, description, disabled, className }: SwitchProps) {
  const id = useId();
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0 space-y-0.5">
        <label htmlFor={id} className={cn("block cursor-pointer text-sm font-medium text-fg", disabled && "cursor-not-allowed")}>
          {label}
        </label>
        {description && <p id={`${id}-desc`} className="text-[13px] text-muted">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-desc` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border border-transparent",
          "transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
          checked ? "bg-accent" : "bg-border-strong",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "pointer-events-none block size-[18px] rounded-full bg-white shadow-sm transition-transform duration-150 dark:bg-bg",
            checked ? "translate-x-[18px]" : "translate-x-[3px]",
          )}
        />
      </button>
    </div>
  );
}
