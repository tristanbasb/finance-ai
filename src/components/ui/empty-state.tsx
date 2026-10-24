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
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-6 py-8 text-center",
        className,
      )}
    >
      {Icon && (
        <span className="inline-flex size-10 items-center justify-center rounded-full bg-surface-2 text-subtle">
          <Icon aria-hidden className="size-5" />
        </span>
      )}
      <div className="space-y-1">
        <p className="text-sm font-medium text-fg">{title}</p>
        {description && <p className="mx-auto max-w-xs text-[13px] text-muted">{description}</p>}
      </div>
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
