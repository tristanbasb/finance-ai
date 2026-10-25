"use client";

import { usePathname } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { badgeCount } from "@/lib/assistant-thread";
import { cn } from "@/lib/cn";
import { ASSISTANT_PATH, useAssistant } from "./assistant-provider";

/**
 * Bouton flottant d'ouverture du panneau (masqué sur la page Assistant). Il reste monté panneau
 * ouvert (recouvert par celui-ci) pour recevoir le focus à la fermeture.
 */
export function ChatBubble() {
  const pathname = usePathname();
  const { open, setOpen, unread } = useAssistant();
  if (pathname === ASSISTANT_PATH) return null;

  const count = unread.count;
  const label = count > 0 ? `Ouvrir l'assistant, ${count} message${count > 1 ? "s" : ""} non lu${count > 1 ? "s" : ""}` : "Ouvrir l'assistant";

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label={label}
      aria-expanded={open}
      data-assistant-trigger=""
      title="Assistant"
      className={cn(
        "fixed right-4 z-30 inline-flex size-14 items-center justify-center rounded-full bg-accent text-accent-fg shadow-pop",
        "bottom-[calc(4rem+env(safe-area-inset-bottom)+0.875rem)] md:right-6 md:bottom-6",
        "transition-[background-color,scale] duration-150 hover:bg-accent/90 active:scale-95",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "starting:scale-90 starting:opacity-0",
      )}
    >
      <MessageCircle aria-hidden className="size-6" />
      {count > 0 && (
        <span
          aria-hidden
          className="num absolute -right-0.5 -top-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[11px] font-semibold text-white ring-2 ring-bg dark:text-bg"
        >
          {badgeCount(count)}
        </span>
      )}
    </button>
  );
}
