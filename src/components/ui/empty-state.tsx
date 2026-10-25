import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export type EmptyStateProps = {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  /** Appel à l'action (lien ou bouton). */
  action?: ReactNode;
  className?: string;
};

/** État vide : une icône discrète, une phrase, une action. */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-border-strong/70 bg-surface-2/50 px-6 py-9 text-center",
        className,
      )}
    >
      {Icon && (
        <span className="inline-flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand">
          <Icon aria-hidden className="size-[22px]" />
        </span>
      )}
      <div className="space-y-1">
        <p className="text-[15px] font-semibold text-fg">{title}</p>
        {description && <p className="mx-auto max-w-xs text-[13px] text-muted">{description}</p>}
      </div>
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
