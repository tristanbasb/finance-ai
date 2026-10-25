"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Maximize2, SquarePen, X } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { excerpt, kindLabel, unreadAssistantIds, type ThreadMessage } from "@/lib/assistant-thread";
import { errorMessage } from "@/lib/http";
import { decodeSse } from "@/lib/sse";
import { cn } from "@/lib/cn";
import { useAssistant } from "./assistant-provider";
import { Composer } from "./composer";
import { ModelSelect } from "./model-select";
import { ThreadView, useThread, type PendingUser, type ThreadFailure } from "./thread";
import { UNREAD_POLL_MS } from "./use-unread";

export { SUGGESTIONS, TOOL_LABELS, toolLabel } from "./thread";

/** Délai de regroupement des marquages « lu ». */
const READ_BATCH_MS = 400;

type Failure = { message: string; content: string; saved: boolean };

/**
 * Conversation avec Claude (fil persistant + saisie), partagée par le panneau latéral et la page
 * Assistant. La réponse est générée et enregistrée côté serveur ; le flux SSE ne sert qu'à
 * l'affichage en direct, et le fil est toujours rechargé à la fin.
 */
export function AssistantConversation({
  variant,
  onClose,
  titleId,
}: {
  variant: "panel" | "page";
  onClose?: () => void;
  titleId?: string;
}) {
  const { aiEnabled, focusId, clearFocus, refreshUnread, unread, setOpen } = useAssistant();
  const thread = useThread();
  const { refreshTail, upsert, messages } = thread;

  const [pending, setPending] = useState<PendingUser | null>(null);
  const [stream, setStream] = useState<{ text: string; tool: string | null } | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [scrollSignal, setScrollSignal] = useState(0);
  const [creatingDivider, setCreatingDivider] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const streamingRef = useRef(false);
  const streaming = stream !== null;

  // Annonce (lecteurs d'écran) des nouveaux messages de Claude, une fois complets.
  const reloadTail = useCallback(async () => {
    const fresh = await refreshTail();
    const last = [...fresh].reverse().find((m) => m.role === "assistant");
    if (last) setAnnouncement(`${kindLabel(last.kind)} : ${excerpt(last.content, 200)}`);
    return fresh;
  }, [refreshTail]);

  // Le fil ouvert se recharge régulièrement (messages Telegram, alertes) et au retour sur l'onglet.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible" && !streamingRef.current) void reloadTail();
    };
    const timer = setInterval(tick, UNREAD_POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [reloadTail]);

  // Un non-lu plus récent que le fil affiché (détecté par la cloche) : rechargement immédiat.
  const lastId = messages[messages.length - 1]?.id ?? 0;
  const newestUnread = unread.latest[0]?.id ?? 0;
  useEffect(() => {
    if (thread.status === "ready" && newestUnread > lastId && !streamingRef.current) void reloadTail();
  }, [newestUnread, lastId, thread.status, reloadTail]);

  // Marquage « lu » groupé des messages affichés.
  const toMark = useRef(new Set<number>());
  const markTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesRef = useRef<ThreadMessage[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const flushRead = useCallback(async () => {
    markTimer.current = null;
    const ids = [...toMark.current];
    toMark.current.clear();
    if (!ids.length) return;
    try {
      const res = await fetch("/api/messages/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) return;
      const at = Date.now();
      const wanted = new Set(ids);
      upsert(messagesRef.current.filter((m) => wanted.has(m.id)).map((m) => ({ ...m, readAt: m.readAt ?? at })));
      void refreshUnread();
    } catch {
      /* nouvel essai au prochain affichage */
    }
  }, [upsert, refreshUnread]);

  const onSeen = useCallback(
    (ids: number[]) => {
      const unreadIds = new Set(unreadAssistantIds(messagesRef.current));
      for (const id of ids) if (unreadIds.has(id)) toMark.current.add(id);
      if (toMark.current.size && !markTimer.current) markTimer.current = setTimeout(() => void flushRead(), READ_BATCH_MS);
    },
    [flushRead],
  );

  useEffect(
    () => () => {
      if (markTimer.current) clearTimeout(markTimer.current);
    },
    [],
  );

  const send = useCallback(
    async (content: string) => {
      if (streamingRef.current) return;
      streamingRef.current = true;
      setFailure(null);
      setPending({ content, failed: false });
      setStream({ text: "", tool: null });
      setScrollSignal((n) => n + 1);
      setAnnouncement("Claude prépare sa réponse…");

      const controller = new AbortController();
      abortRef.current = controller;
      let error: string | null = null;
      let saved = false; // message utilisateur enregistré côté serveur
      let stopped = false;
      try {
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          error = await errorMessage(res);
        } else {
          saved = true;
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
          let buffer = "";
          let finished = false;
          while (!finished) {
            const { value, done } = await reader.read();
            if (done) break;
            const { events, rest } = decodeSse(buffer + value);
            buffer = rest;
            for (const event of events) {
              if (event.type === "text") setStream((s) => ({ text: (s?.text ?? "") + event.text, tool: null }));
              else if (event.type === "tool") setStream((s) => ({ text: s?.text ?? "", tool: event.name }));
              else if (event.type === "error") error = event.error;
              else if (event.type === "done") finished = true;
            }
          }
          if (!finished && !error) error = "La réponse a été interrompue. Réessayez.";
        }
      } catch {
        if (controller.signal.aborted) stopped = true;
        else error = "Connexion à l'assistant impossible. Réessayez.";
        // Requête partie : le message a pu être enregistré ; le fil rechargé le dira.
        saved = true;
      }
      if (abortRef.current === controller) abortRef.current = null;

      // Le fil fait foi : réponse enregistrée, réponse d'une génération concurrente, texte interrompu.
      await reloadTail();
      const kept = !saved;
      setStream(null);
      setPending(kept ? { content, failed: true } : null);
      setFailure(error ? { message: error, content, saved } : null);
      if (stopped) {
        setAnnouncement("Réponse interrompue.");
        // Le texte partiel est enregistré juste après l'interruption.
        setTimeout(() => void reloadTail(), 1500);
      } else if (error) {
        setAnnouncement("");
      }
      streamingRef.current = false;
    },
    [reloadTail],
  );

  function stop() {
    abortRef.current?.abort();
  }

  async function newConversation() {
    setCreatingDivider(true);
    try {
      const res = await fetch("/api/messages/divider", { method: "POST" });
      if (!res.ok) throw new Error(await errorMessage(res));
      const body = (await res.json()) as { message: ThreadMessage };
      upsert([body.message]);
      setFailure(null);
      setPending(null);
      setScrollSignal((n) => n + 1);
      setAnnouncement("Nouvelle conversation : Claude repart de zéro.");
    } catch (err) {
      toast.error("Nouvelle conversation impossible", {
        description: err instanceof Error && err.message ? err.message : "Le serveur ne répond pas. Réessayez.",
      });
    } finally {
      setCreatingDivider(false);
    }
  }

  const threadFailure: ThreadFailure | null = failure
    ? { message: failure.message, onRetry: aiEnabled && !streaming ? () => void send(failure.content) : undefined }
    : null;

  const lastIsDivider = messages[messages.length - 1]?.role === "divider";
  const newConversationButton = (
    <Button
      variant={variant === "panel" ? "ghost" : "secondary"}
      size={variant === "panel" ? "icon" : "sm"}
      onClick={() => void newConversation()}
      loading={creatingDivider}
      disabled={streaming || lastIsDivider || messages.length === 0}
      title="Claude repart de zéro (le fil reste affiché)"
    >
      {!creatingDivider && <SquarePen aria-hidden />}
      <span className={variant === "panel" ? "sr-only" : undefined}>Nouvelle conversation</span>
    </Button>
  );

  const body = (
    <>
      <ThreadView
        thread={thread}
        pending={pending}
        stream={stream}
        failure={threadFailure}
        focusId={focusId}
        onFocusDone={clearFocus}
        onSeen={onSeen}
        onSuggestion={aiEnabled ? (q) => void send(q) : undefined}
        scrollSignal={scrollSignal}
        className={cn("flex-1", variant === "panel" ? "px-4 py-5" : "px-4 py-5 sm:px-6")}
        innerClassName={variant === "page" ? "max-w-3xl" : undefined}
      />
      <div
        className={cn(
          "border-t border-border bg-surface px-4 pt-3",
          variant === "panel" ? "pb-[max(0.75rem,env(safe-area-inset-bottom))]" : "pb-3 sm:px-6",
        )}
      >
        <Composer
          onSend={(text) => void send(text)}
          onStop={stop}
          streaming={streaming}
          disabled={!aiEnabled}
          autoFocus={variant === "panel"}
          className={variant === "page" ? "mx-auto max-w-3xl" : undefined}
        />
      </div>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </>
  );

  if (variant === "panel") {
    return (
      <div className="flex h-full flex-col">
        <PanelHeader titleId={titleId}>
          <ModelSelect />
          {newConversationButton}
          {/* Plein écran : inutile sur mobile, où le panneau occupe déjà tout l'écran. */}
          <span className="hidden md:contents">
            <Link
              href="/assistant"
              onClick={() => setOpen(false)}
              aria-label="Ouvrir l'assistant en plein écran"
              title="Plein écran"
              className={buttonClasses({ variant: "ghost", size: "icon" })}
            >
              <Maximize2 aria-hidden />
            </Link>
          </span>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fermer l'assistant" title="Fermer (Échap)">
            <X aria-hidden />
          </Button>
        </PanelHeader>
        {body}
      </div>
    );
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <p className="text-[13px] text-muted">Réponses, alertes et bilans de Claude</p>
          <h1 className="text-2xl font-semibold tracking-[-0.025em] text-fg sm:text-[28px]">Assistant</h1>
        </div>
        <div className="flex items-center gap-2">
          <ModelSelect />
          {newConversationButton}
        </div>
      </header>
      <Card className="flex h-[calc(100dvh-17rem)] min-h-[26rem] flex-col overflow-hidden md:h-[calc(100dvh-12.5rem)]">
        {body}
      </Card>
    </div>
  );
}

function PanelHeader({ titleId, children }: { titleId?: string; children: ReactNode }) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4 pt-[env(safe-area-inset-top)] box-content">
      <h2 id={titleId} className="mr-auto text-[15px] font-semibold tracking-[-0.01em] text-fg">
        Assistant
      </h2>
      {children}
    </div>
  );
}
