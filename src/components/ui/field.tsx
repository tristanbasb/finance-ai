import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Classes partagées par les champs de saisie (input, select, textarea). */
export const controlClasses =
  // 16 px sur mobile (évite le zoom iOS au focus), 44 px de haut sur écran tactile.
  "h-10 w-full rounded-xl border border-border-strong/70 bg-surface px-3.5 text-base text-fg sm:text-sm " +
  "pointer-coarse:h-11 placeholder:text-subtle transition-[border-color,box-shadow] duration-150 " +
  "hover:border-border-strong focus-visible:border-ring focus-visible:outline-none " +
  "focus-visible:ring-4 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-60 " +
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
        <label htmlFor={id} className="block text-[13px] font-semibold text-fg">
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
