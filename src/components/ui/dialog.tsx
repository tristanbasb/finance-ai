"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

export type DialogProps = {
  open: boolean;
  /** Appelé sur Échap, clic sur le fond ou bouton de fermeture. */
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Boutons d'action, alignés à droite. */
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
};

const widths = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" } as const;

/**
 * Boîte de dialogue modale sur `<dialog>` natif : fond, piège de focus et Échap fournis
 * par le navigateur ; le focus revient à l'élément d'origine à la fermeture.
 * Le premier élément focalisable (ou celui marqué `autoFocus`) reçoit le focus.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  className,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocus.current = document.activeElement as HTMLElement | null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Restaure le focus quand le dialogue se ferme (ou est démonté ouvert).
  useEffect(() => {
    if (open) return;
    returnFocus.current?.focus?.();
    returnFocus.current = null;
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
      onMouseDown={(e) => {
        // Clic sur le fond : la cible est le <dialog> lui-même, hors du panneau.
        if (e.target === e.currentTarget) onClose();
      }}
      className={cn(
        "m-auto w-[calc(100%-2rem)] rounded-2xl border border-border bg-surface p-0 text-fg shadow-pop",
        "opacity-100 transition-[opacity,scale] duration-150 ease-out starting:open:scale-[0.97] starting:open:opacity-0",
        widths[size],
        className,
      )}
    >
      <div className="relative flex max-h-[85dvh] flex-col">
        <div className="space-y-1 px-6 pb-2 pr-14 pt-6">
          <h2 id={titleId} className="text-base font-semibold tracking-[-0.01em]">
            {title}
          </h2>
          {description && (
            <p id={descriptionId} className="text-[13px] text-muted">
              {description}
            </p>
          )}
        </div>
        <div className="overflow-y-auto px-6 py-4">{children}</div>
        {footer && (
          <div className="flex flex-col-reverse gap-2 border-t border-border px-6 py-4 sm:flex-row sm:justify-end">
            {footer}
          </div>
        )}
        {/* Placé en dernier dans le DOM pour ne pas prendre le focus initial. */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer"
          className="absolute right-4 top-4 inline-flex size-8 items-center justify-center rounded-lg text-subtle transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>
    </dialog>
  );
}
