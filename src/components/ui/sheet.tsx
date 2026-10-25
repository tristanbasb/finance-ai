"use client";

import { useEffect, useId, type RefObject } from "react";
import { cn } from "@/lib/cn";
import { DialogCloseButton, modalHandlers, useModalDialog, type DialogProps } from "./dialog";

export type SheetProps = DialogProps;

const widths = { sm: "md:max-w-sm", md: "md:max-w-lg", lg: "md:max-w-2xl" } as const;

/**
 * Suit le clavier virtuel : pose sur le `<dialog>` la hauteur visible (`--sheet-vh`) et la
 * hauteur masquée en bas (`--sheet-kb`) d'après `visualViewport`, pour que la feuille
 * remonte au-dessus du clavier et que le champ actif reste visible.
 */
function useVisualViewport(ref: RefObject<HTMLDialogElement | null>, open: boolean) {
  useEffect(() => {
    const dialog = ref.current;
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!open || !dialog || !vv) return;

    const update = () => {
      const hidden = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      dialog.style.setProperty("--sheet-vh", `${vv.height}px`);
      dialog.style.setProperty("--sheet-kb", `${hidden}px`);
      // Après redimensionnement, ramène le champ focalisé dans la zone visible.
      const active = document.activeElement;
      if (hidden > 0 && active instanceof HTMLElement && dialog.contains(active)) {
        active.scrollIntoView({ block: "nearest" });
      }
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      dialog.style.removeProperty("--sheet-vh");
      dialog.style.removeProperty("--sheet-kb");
    };
  }, [ref, open]);
}

/**
 * Feuille modale : glisse depuis le bas sur téléphone (< 768 px), fenêtre centrée au-delà.
 * Mêmes props et même comportement que `Dialog` (`<dialog>` natif, piège de focus, Échap,
 * clic sur le fond, retour du focus) ; contenu défilant, pied d'actions toujours visible.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  className,
}: SheetProps) {
  const ref = useModalDialog(open);
  const titleId = useId();
  const descriptionId = useId();
  useVisualViewport(ref, open);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      {...modalHandlers(open, onClose)}
      className={cn(
        "max-h-none max-w-none border border-border bg-surface p-0 text-fg shadow-pop",
        // Téléphone : collée en bas, au-dessus du clavier virtuel.
        "mx-0 mt-auto mb-[var(--sheet-kb,0px)] w-full rounded-t-hero border-b-0",
        "transition-[translate,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] starting:open:translate-y-full",
        // Ordinateur / tablette : fenêtre centrée.
        "md:m-auto md:w-[calc(100%-2rem)] md:rounded-hero md:border-b",
        "md:duration-150 md:ease-out md:starting:open:translate-y-0 md:starting:open:scale-[0.97] md:starting:open:opacity-0",
        "motion-reduce:transition-none",
        widths[size],
        className,
      )}
    >
      <div className="relative flex max-h-[calc(var(--sheet-vh,100dvh)*0.9)] flex-col md:max-h-[85dvh]">
        {/* Poignée purement décorative. */}
        <div aria-hidden className="flex justify-center pt-2.5 md:hidden">
          <span className="h-1.5 w-10 rounded-full bg-border-strong" />
        </div>
        <div className="space-y-1 px-5 pb-2 pr-14 pt-3 md:px-6 md:pt-6">
          <h2 id={titleId} className="text-lg font-bold tracking-[-0.015em]">
            {title}
          </h2>
          {description && (
            <p id={descriptionId} className="text-[13px] text-muted">
              {description}
            </p>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 md:px-6">{children}</div>
        {footer && (
          <div className="flex flex-col-reverse gap-2 border-t border-border bg-surface px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 md:flex-row md:justify-end md:bg-surface-2/40 md:px-6 md:pb-4">
            {footer}
          </div>
        )}
        <DialogCloseButton onClose={onClose} className="top-3 md:top-4" />
      </div>
    </dialog>
  );
}
