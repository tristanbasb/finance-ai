import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Classes partagées par les champs de saisie (input, select, textarea). */
export const controlClasses =
  "h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-fg " +
  "placeholder:text-subtle transition-[border-color,box-shadow] duration-150 " +
  "hover:border-border-strong focus-visible:border-accent focus-visible:outline-none " +
  "focus-visible:ring-3 focus-visible:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-60 " +
  "aria-invalid:border-danger aria-invalid:focus-visible:ring-danger/20";

/** Libellé, aide et message d'erreur autour d'un champ. */
export function Field({
  id,
  label,
  hint,
  error,
  className,
  children,
}: {
  id: string;
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <label htmlFor={id} className="block text-[13px] font-medium text-fg">
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-[13px] text-muted">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

/** `aria-describedby` correspondant à ce qu'affiche `Field`. */
export function describedBy(id: string, hint?: ReactNode, error?: ReactNode): string | undefined {
  if (error) return `${id}-error`;
  if (hint) return `${id}-hint`;
  return undefined;
}
