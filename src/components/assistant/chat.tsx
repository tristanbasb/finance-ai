"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Maximize2, PanelRightClose, Sparkles, SquarePen, X } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import {
  excerpt,
  hasSavedQuestion,
  kindLabel,
  tailIsBehind,
  unreadAssistantIds,
  type ThreadMessage,
} from "@/lib/assistant-thread";
import { messageActionIds, undoneActionId } from "@/lib/ai-actions-ui";
import { errorMessage } from "@/lib/http";
import { decodeSse } from "@/lib/sse";
import { cn } from "@/lib/cn";
import { useAssistant } from "./assistant-provider";
import { Composer } from "./composer";
import { ModelSelect } from "./model-select";
import { ThreadView, useThread, type PendingUser, type ThreadFailure } from "./thread";

export { SUGGESTIONS, TOOL_LABELS, WRITE_TOOL_LABEL, toolLabel } from "./thread";

/** Délai de regroupement des marquages « lu ». */
const READ_BATCH_MS = 400;

type Failure = { message: string; content: string; saved: boolean };

/**
 * Conversation avec Claude (fil persistant + saisie), partagée par le panneau latéral, la colonne
 * Claude (grand écran) et la page Assistant. La réponse est générée et enregistrée côté serveur ; le flux SSE ne sert qu'à
 * l'affichage en direct, et le fil est toujours rechargé à la fin.
 */
export function AssistantConversation({
  variant,
  onClose,
  onCollapse,
  titleId,
}: {
  variant: "panel" | "column" | "page";
  onClose?: () => void;
  /** Colonne : la replier (la bulle et le panneau prennent le relais). */
  onCollapse?: () => void;
  titleId?: string;
}) {
  const { aiEnabled, focusId, clearFocus, refreshUnread, unread, setOpen } = useAssistant();
  const router = useRouter();
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

  // Annonce (lecteurs d'écran) des nouveaux messages de Claude, une fois complets. Un nouveau
  // message porteur de modifications (réponse avec actions, ou annulation venue d'ailleurs, de
  // Telegram par exemple) rafraîchit la page affichée : ses données ont changé.
  const reloadTail = useCallback(async () => {
    const fresh = await refreshTail();
    const last = [...(fresh ?? [])].reverse().find((m) => m.role === "assistant");
    if (last) {
      const note = undoneActionId(last) !== null;
      setAnnouncement(note ? last.content : `${kindLabel(last.kind)} : ${excerpt(last.content, 200)}`);
    }
    if (fresh?.some((m) => messageActionIds(m).length > 0 || undoneActionId(m) !== null)) router.refresh();
    return fresh;
  }, [refreshTail, router]);

  // Pas de relevé périodique propre au fil : `useUnread` (cloche) interroge déjà le serveur toutes
  // les 20 s. Un non-lu, ou un message déjà lu (note d'annulation venue de Telegram), plus récent
  // que le fil affiché déclenche le rechargement de sa fin ; le retour sur l'onglet le recharge
  // aussi (messages Telegram envoyés entre-temps).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && !streamingRef.current) void reloadTail();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reloadTail]);

  const lastId = messages[messages.length - 1]?.id ?? 0;
  const behind = tailIsBehind({
    ready: thread.status === "ready",
    streaming,
    lastId,
    unread: unread.latest,
    latestId: unread.lastId,
  });
  useEffect(() => {
    if (behind && !streamingRef.current) void reloadTail();
  }, [behind, unread.latest, unread.lastId, reloadTail]);

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

  /**
   * Envoie une question (`content`) ou relance la réponse aux questions déjà enregistrées
   * (`retry`, après une erreur survenue une fois la question enregistrée : rien n'est ajouté).
   *
   * La requête n'est volontairement pas annulée quand le panneau se ferme ou que la page change :
   * le serveur interromprait la génération et enregistrerait une réponse « (interrompu) ». Elle
   * se termine en arrière-plan ; la réponse arrive dans le fil (et en notification).
   */
  const run = useCallback(
    async (request: { content: string } | { retry: true }, question: string) => {
      if (streamingRef.current) return;
      streamingRef.current = true;
      const isRetry = "retry" in request;
      setFailure(null);
      setPending(isRetry ? null : { content: question, failed: false });
      setStream({ text: "", tool: null });
      setScrollSignal((n) => n + 1);
      setAnnouncement("Claude prépare sa réponse…");

      const controller = new AbortController();
      abortRef.current = controller;
      let error: string | null = null;
      // Question enregistrée côté serveur : vrai, faux, ou inconnu (exception réseau).
      let saved: boolean | null = isRetry;
      let stopped = false;
      try {
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
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
        // Requête partie : la question a pu être enregistrée ; le fil rechargé le dira.
        if (!isRetry) saved = null;
      }
      if (abortRef.current === controller) abortRef.current = null;

      // Le fil fait foi : réponse enregistrée, réponse d'une génération concurrente, texte interrompu.
      const fresh = await reloadTail();
      if (saved === null) saved = hasSavedQuestion(fresh, question);
      setStream(null);
      // Question non enregistrée (ou introuvable) : gardée à l'écran, « Non envoyé ».
      setPending(!isRetry && !saved ? { content: question, failed: true } : null);
      setFailure(error ? { message: error, content: question, saved } : null);
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

  const send = useCallback((content: string) => run({ content }, content), [run]);

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
    ? {
        message: failure.message,
        // Question déjà enregistrée : relance sans la renvoyer (pas de doublon dans le fil).
        onRetry:
          aiEnabled && !streaming
            ? () => void (failure.saved ? run({ retry: true }, failure.content) : send(failure.content))
            : undefined,
      }
    : null;

  const lastIsDivider = messages[messages.length - 1]?.role === "divider";
  const compact = variant !== "page";
  const newConversationButton = (
    <Button
      variant={compact ? "ghost" : "secondary"}
      size={compact ? "icon" : "sm"}
      onClick={() => void newConversation()}
      loading={creatingDivider}
      disabled={streaming || lastIsDivider || messages.length === 0}
      title="Claude repart de zéro (le fil reste affiché)"
    >
      {!creatingDivider && <SquarePen aria-hidden />}
      <span className={compact ? "sr-only" : undefined}>Nouvelle conversation</span>
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
        className={cn("flex-1", compact ? "px-4 py-5" : "px-4 py-5 sm:px-6")}
        innerClassName={variant === "page" ? "max-w-3xl" : undefined}
      />
      <div
        className={cn(
          "border-t border-border bg-surface px-4 pt-3",
          variant === "panel" ? "pb-[max(0.75rem,env(safe-area-inset-bottom))]" : variant === "column" ? "pb-3" : "pb-3 sm:px-6",
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

  if (variant === "column") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PanelHeader titleId={titleId} title="Claude">
          {/* Largeur de colonne limitée : le sélecteur cède la place aux boutons. */}
          <ModelSelect className="min-w-0 [&_select]:max-w-[9rem]" />
          {newConversationButton}
          <Button
            variant="ghost"
            size="icon"
            onClick={onCollapse}
            aria-label="Replier la colonne Claude"
            title="Replier la colonne"
          >
            <PanelRightClose aria-hidden />
          </Button>
        </PanelHeader>
        {body}
      </div>
    );
  }

  if (variant === "panel") {
    return (
      <div className="flex h-full flex-col">
        <PanelHeader titleId={titleId} title="Assistant">
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
      {/* Téléphone : l'en-tête de l'application porte déjà le titre ; le fil prend la place. */}
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="space-y-1 max-md:sr-only">
          <p className="text-[13px] text-muted">Réponses, alertes et bilans de Claude</p>
          <h1 className="text-2xl font-semibold tracking-[-0.025em] text-fg md:text-[28px]">Assistant</h1>
        </div>
        <div className="flex w-full min-w-0 items-center justify-between gap-2 md:w-auto">
          <ModelSelect className="min-w-0" />
          {newConversationButton}
        </div>
      </header>
      {/* Hauteur : fenêtre moins l'en-tête mobile, la ligne d'actions et la barre du bas (bouton « + » compris). */}
      <Card className="flex h-[calc(100dvh-var(--mobile-header-h)-11rem-env(safe-area-inset-bottom))] min-h-[24rem] flex-col overflow-hidden md:h-[calc(100dvh-12.5rem)]">
        {body}
      </Card>
    </div>
  );
}

function PanelHeader({ titleId, title, children }: { titleId?: string; title: string; children: ReactNode }) {
  return (
    <div className="box-content flex h-14 shrink-0 items-center gap-1.5 border-b border-border px-4 pt-[env(safe-area-inset-top)]">
      <h2 id={titleId} className="mr-auto flex min-w-0 items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] text-fg">
        <span aria-hidden className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-white">
          <Sparkles className="size-3.5" />
        </span>
        <span className="truncate">{title}</span>
      </h2>
      {children}
    </div>
  );
}
