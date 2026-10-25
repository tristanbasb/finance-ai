"use client";

import { useEffect, useId, useRef } from "react";
import { cn } from "@/lib/cn";
import { useAssistant } from "./assistant-provider";
import { AssistantConversation } from "./chat";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Panneau latéral de l'assistant (≈ 420 px sur ordinateur, plein écran sur mobile) : modal
 * (focus piégé puis rendu à l'élément d'origine, Échap ferme, défilement de la page bloqué sur
 * mobile). Le contenu n'est monté qu'à l'ouverture : le fil est rechargé à chaque fois.
 */
export function ChatPanel() {
  const { open, setOpen } = useAssistant();
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!panel.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    // Focus initial : la zone de saisie si elle est active (Composer autoFocus), sinon le panneau.
    const t = setTimeout(() => {
      if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
    }, 0);

    // Plein écran sur mobile : la page derrière ne défile plus.
    const mobile = window.matchMedia("(max-width: 767px)").matches;
    const previousOverflow = document.documentElement.style.overflow;
    if (mobile) document.documentElement.style.overflow = "hidden";

    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKeyDown);
      if (mobile) document.documentElement.style.overflow = previousOverflow;
      // Focus rendu à l'élément d'origine, à défaut à la bulle (ouverture sans focus clavier).
      const origin = returnFocus.current;
      returnFocus.current = null;
      const target =
        origin && origin !== document.body && document.contains(origin)
          ? origin
          : document.querySelector<HTMLElement>("[data-assistant-trigger]");
      target?.focus({ preventScroll: true });
    };
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40">
      <div
        aria-hidden
        onMouseDown={() => setOpen(false)}
        className="absolute inset-0 hidden bg-[rgb(10_12_16/0.28)] transition-opacity duration-200 starting:opacity-0 md:block"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "absolute inset-0 flex flex-col bg-surface text-fg outline-none",
          "md:inset-y-0 md:left-auto md:right-0 md:w-[420px] md:border-l md:border-border md:shadow-pop",
          "transition-[translate,opacity] duration-200 ease-out starting:translate-y-3 starting:opacity-0 md:starting:translate-x-6 md:starting:translate-y-0",
        )}
      >
        <AssistantConversation variant="panel" titleId={titleId} onClose={() => setOpen(false)} />
      </div>
    </div>
  );
}
