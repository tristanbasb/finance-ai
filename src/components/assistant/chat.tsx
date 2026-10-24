"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { ArrowUp, Bot, CircleAlert, LoaderCircle, RotateCcw, SquarePen, Square, Sparkles } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Markdown } from "@/components/assistant/markdown";
import { errorMessage } from "@/lib/http";
import { decodeSse } from "@/lib/sse";
import { cn } from "@/lib/cn";

type Message = { id: string; role: "user" | "assistant"; content: string; stopped?: boolean };

const STORAGE_KEY = "finance-ai.assistant.conversation.v1";
const MAX_HISTORY = 50;
const MAX_CONTENT = 8000;

export const SUGGESTIONS = [
  "Où part mon argent ce mois-ci ?",
  "Comment améliorer mon taux d'épargne ?",
  "Résume mes investissements",
  "Suis-je dans les clous de mes budgets ?",
] as const;

const TOOL_LABELS: Record<string, string> = {
  get_overview: "Consultation de votre situation…",
  search_transactions: "Consultation de vos transactions…",
  spending_by_category: "Analyse de vos dépenses par catégorie…",
  get_holdings: "Consultation de vos investissements…",
  get_goals: "Consultation de vos objectifs d'épargne…",
};

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? "Consultation de vos données…";
}

let idCounter = 0;
function newId(): string {
  idCounter += 1;
  return `${Date.now().toString(36)}-${idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

function isMessage(value: unknown): value is Message {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && (v.role === "user" || v.role === "assistant") && typeof v.content === "string";
}

function loadConversation(): Message[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isMessage).filter((m) => m.content !== "") : [];
  } catch {
    return [];
  }
}

function saveConversation(messages: Message[]): void {
  try {
    if (messages.length === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  } catch {
    /* stockage indisponible (navigation privée, quota) : la conversation reste en mémoire */
  }
}

/** Historique envoyé à l'API : 50 derniers messages non vides, commençant par une question. */
function toPayload(history: Message[]) {
  const recent = history
    .filter((m) => m.content.trim() !== "")
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CONTENT) }));
  while (recent.length > 0 && recent[0].role !== "user") recent.shift();
  return recent;
}

const noSubscribe = () => () => {};

/** Faux au rendu serveur et à l'hydratation, vrai ensuite (localStorage accessible). */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
}

export function AssistantChat({ enabled }: { enabled: boolean }) {
  const hydrated = useHydrated();
  if (!enabled) return <DisabledState />;
  // La conversation est restaurée depuis localStorage : rendue uniquement côté navigateur.
  return hydrated ? <Conversation /> : <ConversationSkeleton />;
}

function ConversationSkeleton() {
  return (
    <div className="space-y-5 sm:space-y-6" aria-busy="true">
      <PageHeader />
      <Card className="h-[calc(100dvh-17rem)] min-h-[26rem] md:h-[calc(100dvh-12.5rem)]" />
    </div>
  );
}

function PageHeader({ action }: { action?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-1">
        <p className="text-[13px] text-muted">Propulsé par Claude</p>
        <h1 className="text-2xl font-semibold tracking-[-0.025em] text-fg sm:text-[28px]">Assistant</h1>
      </div>
      {action}
    </header>
  );
}

const codeClasses = "rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12px] text-fg";

function DisabledState() {
  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader />
      <Card className="flex flex-col items-center gap-4 px-6 py-14 text-center">
        <span className="inline-flex size-12 items-center justify-center rounded-full bg-surface-2 text-subtle">
          <Bot aria-hidden className="size-6" />
        </span>
        <div className="max-w-md space-y-1.5">
          <h2 className="text-[15px] font-semibold text-fg">Assistant IA désactivé</h2>
          <p className="text-[13px] leading-relaxed text-muted">
            Ajoutez la variable <code className={codeClasses}>ANTHROPIC_API_KEY</code> au fichier{" "}
            <code className={codeClasses}>.env</code>, puis redémarrez l&apos;application.
          </p>
        </div>
        <Link href="/settings#ia" className={buttonClasses({ variant: "secondary" })}>
          Voir les réglages
        </Link>
      </Card>
    </div>
  );
}

function Conversation() {
  const [messages, setMessages] = useState<Message[]>(loadConversation);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    if (!streaming) saveConversation(messages);
  }, [messages, streaming]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Défilement automatique tant que l'utilisateur est en bas de la conversation.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, activeTool, error, streaming]);

  // Zone de saisie qui grandit avec le texte (6 lignes environ au maximum).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  const run = useCallback(async (history: Message[]) => {
    const assistantId = newId();
    stickToBottom.current = true;
    setMessages([...history, { id: assistantId, role: "assistant", content: "" }]);
    setError(null);
    setActiveTool(null);
    setStreaming(true);
    setAnnouncement("Réponse en cours…");

    const controller = new AbortController();
    abortRef.current = controller;
    const append = (text: string) =>
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + text } : m)));

    let failure: string | null = null;
    let stopped = false;
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: toPayload(history) }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        failure = await errorMessage(res);
      } else {
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        let finished = false;
        while (!finished) {
          const { value, done } = await reader.read();
          if (done) break;
          const { events, rest } = decodeSse(buffer + value);
          buffer = rest;
          for (const event of events) {
            if (event.type === "text") {
              setActiveTool(null);
              append(event.text);
            } else if (event.type === "tool") {
              setActiveTool(event.name);
              setAnnouncement(toolLabel(event.name));
            } else if (event.type === "error") {
              failure = event.error;
            } else {
              finished = true;
            }
          }
        }
        if (!finished && !failure) failure = "La réponse a été interrompue. Réessayez.";
      }
    } catch {
      if (controller.signal.aborted) stopped = true;
      else failure = "Connexion à l'assistant impossible. Réessayez.";
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setMessages((prev) =>
        prev.flatMap((m) => {
          if (m.id !== assistantId) return [m];
          if (m.content.trim() === "") return [];
          return [stopped || failure ? { ...m, stopped: true } : m];
        }),
      );
      setStreaming(false);
      setActiveTool(null);
      setError(failure);
      setAnnouncement(failure ? "" : stopped ? "Réponse interrompue." : "Réponse de l'assistant reçue.");
    }
  }, []);

  function send(text: string) {
    const content = text.trim();
    if (!content || streaming) return;
    setInput("");
    void run([...messages, { id: newId(), role: "user", content: content.slice(0, MAX_CONTENT) }]);
    textareaRef.current?.focus();
  }

  function retry() {
    if (streaming || messages[messages.length - 1]?.role !== "user") return;
    void run(messages);
  }

  function stop() {
    abortRef.current?.abort();
    textareaRef.current?.focus();
  }

  function reset() {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setInput("");
    setAnnouncement("Nouvelle conversation.");
    textareaRef.current?.focus();
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    send(input);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(input);
    }
  }

  const empty = messages.length === 0;
  const lastIsUser = messages[messages.length - 1]?.role === "user";

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        action={
          messages.length > 0 && (
            <Button variant="secondary" onClick={reset}>
              <SquarePen aria-hidden />
              Nouvelle conversation
            </Button>
          )
        }
      />

      <Card className="flex h-[calc(100dvh-17rem)] min-h-[26rem] flex-col overflow-hidden md:h-[calc(100dvh-12.5rem)]">
        <div
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          }}
          className="flex-1 overflow-y-auto px-4 py-5 sm:px-6"
        >
          {empty ? (
            <Welcome onPick={send} />
          ) : (
            <ol aria-label="Conversation" className="mx-auto max-w-3xl space-y-5">
              {messages.map((m, i) => {
                const isLast = i === messages.length - 1;
                return m.role === "user" ? (
                  <UserBubble key={m.id} text={m.content} />
                ) : (
                  <AssistantBubble
                    key={m.id}
                    text={m.content}
                    stopped={m.stopped === true}
                    pending={streaming && isLast}
                    tool={streaming && isLast ? activeTool : null}
                  />
                );
              })}
              {error && (
                <li
                  role="alert"
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-danger"
                >
                  <CircleAlert aria-hidden className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1">{error}</span>
                  {lastIsUser && (
                    <Button variant="secondary" size="sm" onClick={retry}>
                      <RotateCcw aria-hidden />
                      Réessayer
                    </Button>
                  )}
                </li>
              )}
              {!error && !streaming && lastIsUser && (
                <li className="flex flex-wrap items-center gap-x-3 gap-y-2 pl-10 text-[13px] text-muted">
                  <span>Ce message n&apos;a pas reçu de réponse.</span>
                  <Button variant="secondary" size="sm" onClick={retry}>
                    <RotateCcw aria-hidden />
                    Réessayer
                  </Button>
                </li>
              )}
            </ol>
          )}
        </div>

        <div className="border-t border-border bg-surface px-4 pb-3 pt-3 sm:px-6">
          <form onSubmit={onSubmit} className="mx-auto max-w-3xl">
            <div
              className={cn(
                "flex items-end gap-2 rounded-xl border border-border bg-surface p-1.5 pl-3",
                "transition-[border-color,box-shadow] duration-150 hover:border-border-strong",
                "focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/20",
              )}
            >
              <label htmlFor="assistant-input" className="sr-only">
                Votre question
              </label>
              <textarea
                id="assistant-input"
                ref={textareaRef}
                rows={1}
                value={input}
                maxLength={MAX_CONTENT}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Posez une question sur vos finances…"
                aria-describedby="assistant-hint"
                className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-2 text-sm leading-5 text-fg placeholder:text-subtle focus:outline-none"
              />
              {streaming ? (
                <Button variant="secondary" size="icon" onClick={stop} aria-label="Arrêter la réponse" title="Arrêter">
                  <Square aria-hidden className="fill-current" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon"
                  disabled={input.trim() === ""}
                  aria-label="Envoyer la question"
                  title="Envoyer"
                >
                  <ArrowUp aria-hidden />
                </Button>
              )}
            </div>
            <p id="assistant-hint" className="mt-2 text-center text-[12px] text-subtle">
              Informations générales, pas un conseil financier personnalisé.
              <span className="hidden sm:inline"> Entrée pour envoyer, Maj + Entrée pour un retour à la ligne.</span>
            </p>
          </form>
        </div>
      </Card>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

function Welcome({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center gap-6 py-6 text-center">
      <span className="inline-flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Sparkles aria-hidden className="size-6" />
      </span>
      <div className="space-y-1.5">
        <h2 className="text-[15px] font-semibold text-fg">Posez une question sur vos finances</h2>
        <p className="text-[13px] leading-relaxed text-muted">
          L&apos;assistant consulte vos comptes, transactions, budgets, investissements et objectifs, en lecture seule.
        </p>
      </div>
      <ul aria-label="Questions suggérées" className="grid w-full gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((q) => (
          <li key={q}>
            <button
              type="button"
              onClick={() => onPick(q)}
              className={cn(
                "h-full w-full rounded-xl border border-border bg-surface px-4 py-3 text-left text-[13px] text-fg",
                "transition-[background-color,border-color] duration-150 hover:border-border-strong hover:bg-surface-2",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              )}
            >
              {q}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <li className="flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-sm leading-relaxed text-accent-fg">
        <span className="sr-only">Vous : </span>
        {text}
      </div>
    </li>
  );
}

function AssistantBubble({
  text,
  stopped,
  pending,
  tool,
}: {
  text: string;
  stopped: boolean;
  pending: boolean;
  tool: string | null;
}) {
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden
        className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"
      >
        <Sparkles className="size-3.5" />
      </span>
      <div className="min-w-0 max-w-[85%] space-y-2">
        {(text !== "" || (!tool && pending)) && (
          <div className="break-words rounded-2xl rounded-tl-md bg-surface-2 px-4 py-3 text-sm leading-relaxed text-fg">
            <span className="sr-only">Assistant : </span>
            {text !== "" ? (
              <Markdown text={text} />
            ) : (
              <span className="flex h-5 items-center gap-1" aria-label="L'assistant réfléchit">
                {[0, 150, 300].map((delay) => (
                  <span
                    key={delay}
                    className="size-1.5 animate-pulse rounded-full bg-subtle"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                ))}
              </span>
            )}
          </div>
        )}
        {tool && (
          <p className="flex items-center gap-2 text-[13px] text-muted">
            <LoaderCircle aria-hidden className="size-3.5 animate-spin text-accent" />
            {toolLabel(tool)}
          </p>
        )}
        {stopped && <p className="text-[12px] text-subtle">Réponse interrompue</p>}
      </div>
    </li>
  );
}
