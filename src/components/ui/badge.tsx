import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type BadgeVariant = "neutral" | "accent" | "positive" | "warning" | "danger";

const variants: Record<BadgeVariant, string> = {
  neutral: "bg-surface-2 text-muted",
  accent: "bg-brand-soft text-brand",
  positive: "bg-positive-soft text-positive",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant };

export function Badge({ variant = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-xs font-semibold [&_svg]:size-3.5",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
