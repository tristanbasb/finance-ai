import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

type DivProps = HTMLAttributes<HTMLDivElement>;

/** Carte à bordure fine sur la surface. */
export function Card({ className, ...props }: DivProps) {
  return (
    <div
      className={cn("rounded-2xl border border-border bg-surface", className)}
      {...props}
    />
  );
}

/** En-tête : titre (+ description) à gauche, `action` optionnelle à droite. */
export function CardHeader({
  className,
  action,
  children,
  ...props
}: DivProps & { action?: ReactNode }) {
  return (
    <div
      className={cn("flex items-start justify-between gap-4 px-5 pt-5 sm:px-6 sm:pt-6", className)}
      {...props}
    >
      <div className="min-w-0 space-y-1">{children}</div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn("text-[15px] font-semibold tracking-[-0.01em] text-fg", className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-[13px] text-muted", className)} {...props} />;
}

export function CardContent({ className, ...props }: DivProps) {
  return <div className={cn("px-5 pb-5 pt-4 sm:px-6 sm:pb-6", className)} {...props} />;
}

export function CardFooter({ className, ...props }: DivProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 border-t border-border px-5 py-3 sm:px-6",
        className,
      )}
      {...props}
    />
  );
}
