"use client";

import { useCallback, useSyncExternalStore } from "react";
import { CLAUDE_COLUMN_KEY, CLAUDE_COLUMN_MEDIA, isColumnCollapsed } from "@/lib/navigation";

const CHANGE_EVENT = "finance-ai:claude-column";

// Repli en mémoire quand le stockage est indisponible (navigation privée, données bloquées).
let memory: string | null = null;

function readStored(): string | null {
  try {
    return window.localStorage.getItem(CLAUDE_COLUMN_KEY);
  } catch {
    return memory;
  }
}

function subscribeStored(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/**
 * État replié de la colonne Claude, mémorisé dans le navigateur. Au rendu serveur (et à
 * l'hydratation), la colonne est dépliée ; le script `CLAUDE_COLUMN_BOOT_SCRIPT` a déjà masqué la
 * colonne avant l'affichage si elle était repliée.
 */
export function useClaudeColumnCollapsed(): [boolean, (collapsed: boolean) => void] {
  const collapsed = useSyncExternalStore(
    subscribeStored,
    () => isColumnCollapsed(readStored()),
    () => false,
  );

  const setCollapsed = useCallback((next: boolean) => {
    memory = next ? "collapsed" : null;
    try {
      if (next) window.localStorage.setItem(CLAUDE_COLUMN_KEY, "collapsed");
      else window.localStorage.removeItem(CLAUDE_COLUMN_KEY);
    } catch {
      /* stockage indisponible : l'état reste en mémoire pour la session */
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return [collapsed, setCollapsed];
}

const WIDE_QUERY = CLAUDE_COLUMN_MEDIA;

function subscribeWide(onChange: () => void): () => void {
  const mq = window.matchMedia(WIDE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** Écran assez large pour la colonne Claude (faux au rendu serveur). */
export function useWideScreen(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE_QUERY).matches,
    () => false,
  );
}

