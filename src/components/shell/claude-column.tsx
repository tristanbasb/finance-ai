"use client";

import { useEffect } from "react";
import { useAssistant } from "@/components/assistant/assistant-provider";
import { AssistantConversation } from "@/components/assistant/chat";

/** Contenu monté seulement quand la colonne est réellement affichée (fil chargé, lecture). */
function ColumnConversation({ onCollapse }: { onCollapse: () => void }) {
  const { setColumnVisible } = useAssistant();

  // La colonne tient lieu de panneau tant qu'elle est montée (non-lus, `openAt`, notifications).
  useEffect(() => {
    setColumnVisible(true);
    return () => setColumnVisible(false);
  }, [setColumnVisible]);

  return <AssistantConversation variant="column" onCollapse={onCollapse} />;
}

/**
 * Colonne Claude à droite (≥ 1280 px) : le fil complet et la saisie, toujours ouverts, défilement
 * indépendant. Son affichage est décidé par le CSS (`.claude-column`, voir `globals.css`) pour
 * que la mise en page soit juste avant l'hydratation ; `active` indique qu'elle est visible et
 * monte alors la conversation.
 */
export function ClaudeColumn({ active, onCollapse }: { active: boolean; onCollapse: () => void }) {
  return (
    <aside
      aria-label="Claude"
      data-claude-column-frame=""
      tabIndex={-1}
      className="claude-column fixed inset-y-0 right-0 z-20 w-[var(--claude-column-width)] flex-col border-l border-border bg-surface outline-none"
    >
      {active && <ColumnConversation onCollapse={onCollapse} />}
    </aside>
  );
}
