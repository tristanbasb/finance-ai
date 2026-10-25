"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { toast } from "@/components/ui/toast";
import { clearAssistantConversation } from "@/lib/assistant-storage";
import { excerpt, kindLabel, type ThreadMessage } from "@/lib/assistant-thread";
import { useUnread, type UnreadState } from "./use-unread";

export const ASSISTANT_PATH = "/assistant";

export type AssistantContextValue = {
  /** Panneau latéral ouvert (jamais quand la colonne Claude est affichée). */
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Ouvre le fil (panneau, ou page Assistant si elle est affichée), centré sur `messageId`. */
  openAt: (messageId?: number) => void;
  /** Message à mettre en évidence dans le fil affiché (consommé par le fil). */
  focusId: number | null;
  clearFocus: () => void;
  unread: UnreadState;
  refreshUnread: () => Promise<void>;
  /** Colonne Claude affichée (grand écran) : elle tient lieu de panneau. */
  columnVisible: boolean;
  /** Signalé par la colonne Claude à son affichage et à sa disparition. */
  setColumnVisible: (visible: boolean) => void;
  /** Clé API configurée côté serveur (seule sa présence est connue du navigateur). */
  aiEnabled: boolean;
};

const AssistantContext = createContext<AssistantContextValue | null>(null);

export function useAssistant(): AssistantContextValue {
  const value = useContext(AssistantContext);
  if (!value) throw new Error("useAssistant doit être utilisé sous <AssistantProvider>");
  return value;
}

/** État partagé de l'assistant (panneau, non-lus, notifications), monté dans la mise en page. */
export function AssistantProvider({ aiEnabled, children }: { aiEnabled: boolean; children: ReactNode }) {
  const pathname = usePathname();
  const onAssistantPage = pathname === ASSISTANT_PATH;
  const [openState, setOpenState] = useState(false);
  const [focusId, setFocusId] = useState<number | null>(null);
  const [columnVisible, setColumnVisibleState] = useState(false);
  // Le panneau n'existe ni sur la page Assistant ni à côté de la colonne Claude (le fil y est
  // déjà affiché).
  const open = openState && !onAssistantPage && !columnVisible;

  // L'ancien historique local (avant le fil persistant) est abandonné : clé supprimée une fois.
  useEffect(() => {
    clearAssistantConversation();
  }, []);

  const stateRef = useRef({ open, onAssistantPage, columnVisible });
  useEffect(() => {
    stateRef.current = { open, onAssistantPage, columnVisible };
  }, [open, onAssistantPage, columnVisible]);

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    if (!next) setFocusId(null);
  }, []);

  const openAt = useCallback((messageId?: number) => {
    setFocusId(messageId ?? null);
    const { onAssistantPage: onPage, columnVisible: inColumn } = stateRef.current;
    if (!onPage && !inColumn) setOpenState(true);
  }, []);

  const setColumnVisible = useCallback((visible: boolean) => {
    setColumnVisibleState(visible);
    // La colonne remplace le panneau : il ne doit pas réapparaître quand elle se replie.
    if (visible) setOpenState(false);
  }, []);

  const clearFocus = useCallback(() => setFocusId(null), []);

  const onFresh = useCallback(
    (fresh: ThreadMessage[]) => {
      const { open: isOpen, onAssistantPage: onPage, columnVisible: inColumn } = stateRef.current;
      if (isOpen || onPage || inColumn) return;
      const last = fresh[fresh.length - 1];
      const others = fresh.length - 1;
      toast(others > 0 ? `${kindLabel(last.kind)} et ${others} autre${others > 1 ? "s" : ""} message${others > 1 ? "s" : ""}` : kindLabel(last.kind), {
        variant: last.kind === "alert" ? "warning" : "default",
        description: excerpt(last.content, 80),
        action: { label: "Ouvrir", onClick: () => openAt(last.id) },
      });
    },
    [openAt],
  );

  const { unread, refreshUnread } = useUnread(onFresh);

  const value = useMemo<AssistantContextValue>(
    () => ({
      open,
      setOpen,
      openAt,
      focusId,
      clearFocus,
      unread,
      refreshUnread,
      columnVisible,
      setColumnVisible,
      aiEnabled,
    }),
    [open, setOpen, openAt, focusId, clearFocus, unread, refreshUnread, columnVisible, setColumnVisible, aiEnabled],
  );

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}
