"use client";

import { useEffect } from "react";
import { Sparkles } from "lucide-react";
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
 * Squelette affiché tant que la conversation n'est pas montée (avant l'hydratation, où seul le
 * CSS sait que la colonne est visible) : la colonne n'apparaît jamais vide.
 */
function ColumnSkeleton() {
  return (
    <div aria-busy="true" className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <span aria-hidden className="inline-flex size-7 items-center justify-center rounded-full bg-brand-gradient text-white">
          <Sparkles className="size-3.5" />
        </span>
        <p className="mr-auto text-[15px] font-semibold tracking-[-0.01em] text-fg">Claude</p>
        <span aria-hidden className="h-8 w-28 rounded-lg bg-surface-2" />
      </div>
      <div aria-hidden className="flex-1 space-y-4 px-4 py-5">
        {[70, 85, 55].map((w, i) => (
          <div
            key={w}
            className="h-12 animate-pulse rounded-2xl bg-surface-2 motion-reduce:animate-none"
            style={{ width: `${w}%`, marginLeft: i % 2 === 0 ? "auto" : undefined }}
          />
        ))}
      </div>
      <div aria-hidden className="border-t border-border px-4 pb-3 pt-3">
        <div className="h-12 rounded-xl border border-border bg-surface-2" />
      </div>
      <span className="sr-only">Chargement de la conversation avec Claude</span>
    </div>
  );
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
      {active ? <ColumnConversation onCollapse={onCollapse} /> : <ColumnSkeleton />}
    </aside>
  );
}
