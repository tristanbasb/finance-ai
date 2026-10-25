"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChartColumn, ChevronUp, CircleAlert, LoaderCircle, RotateCcw, Send, Sparkles, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/assistant/markdown";
import {
  fullDateTime,
  isProactive,
  isSeen,
  kindLabel,
  mergeMessages,
  relativeTime,
  type ThreadMessage,
} from "@/lib/assistant-thread";
import type { MessageKind } from "@/lib/queries/messages";
import { cn } from "@/lib/cn";

export const PAGE_SIZE = 50;
/** Pages plus anciennes chargées au plus pour retrouver un message demandé par `openAt`. */
const MAX_FOCUS_PAGES = 5;
/** 0 ; 0,01 ; … ; 1 : rappels de l'observateur assez fréquents pour `isSeen`. */
const SEEN_THRESHOLDS = Array.from({ length: 101 }, (_, i) => i / 100);

export const TOOL_LABELS: Record<string, string> = {
  get_overview: "Consultation de votre situation…",
  search_transactions: "Consultation de vos transactions…",
  spending_by_category: "Analyse de vos dépenses par catégorie…",
  get_holdings: "Consultation de vos investissements…",
  get_goals: "Consultation de vos objectifs d'épargne…",
};

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? "Consultation de vos données…";
}

export const SUGGESTIONS = [
  "Où part mon argent ce mois-ci ?",
  "Comment améliorer mon taux d'épargne ?",
  "Résume mes investissements",
  "Suis-je dans les clous de mes budgets ?",
] as const;

// ---------------------------------------------------------------------------------------------
// Données du fil

async function fetchPage(before?: number): Promise<ThreadMessage[]> {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (before !== undefined) params.set("before", String(before));
  const res = await fetch(`/api/messages?${params}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { messages?: unknown };
  return Array.isArray(body.messages) ? (body.messages as ThreadMessage[]) : [];
}

export type ThreadState = {
  messages: ThreadMessage[];
  status: "loading" | "ready" | "error";
  hasMore: boolean;
  loadingOlder: boolean;
  /** Recharge la fin du fil ; renvoie les messages nouveaux (absents avant), null en cas d'échec. */
  refreshTail: () => Promise<ThreadMessage[] | null>;
  loadOlder: () => Promise<void>;
  /** Ajoute ou remplace des messages localement (séparateur créé, lecture). */
  upsert: (messages: ThreadMessage[]) => void;
};

/** Fil paginé : les 50 derniers messages, puis les pages plus anciennes à la demande. */
export function useThread(): ThreadState {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [status, setStatus] = useState<ThreadState["status"]>("loading");
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const messagesRef = useRef<ThreadMessage[]>([]);
  const loaded = useRef(false);

  const apply = useCallback((next: ThreadMessage[]) => {
    messagesRef.current = next;
    setMessages(next);
  }, []);

  const refreshTail = useCallback(async () => {
    try {
      const page = await fetchPage();
      const known = new Set(messagesRef.current.map((m) => m.id));
      const fresh = loaded.current ? page.filter((m) => !known.has(m.id)) : [];
      if (!loaded.current) {
        loaded.current = true;
        setHasMore(page.length === PAGE_SIZE);
      }
      apply(mergeMessages(messagesRef.current, page));
      setStatus("ready");
      return fresh;
    } catch {
      if (!loaded.current) setStatus("error");
      return null;
    }
  }, [apply]);

  const loadOlder = useCallback(async () => {
    const first = messagesRef.current[0];
    if (!first) return;
    setLoadingOlder(true);
    try {
      const page = await fetchPage(first.id);
      setHasMore(page.length === PAGE_SIZE);
      apply(mergeMessages(page, messagesRef.current));
    } catch {
      /* nouvel essai possible avec le bouton */
    } finally {
      setLoadingOlder(false);
    }
  }, [apply]);

  const upsert = useCallback((list: ThreadMessage[]) => apply(mergeMessages(messagesRef.current, list)), [apply]);

  useEffect(() => {
    const t = setTimeout(() => void refreshTail(), 0);
    return () => clearTimeout(t);
  }, [refreshTail]);

  return { messages, status, hasMore, loadingOlder, refreshTail, loadOlder, upsert };
}

// ---------------------------------------------------------------------------------------------
// Présentation

const kindStyles: Record<"alert" | "weekly" | "monthly", { icon: typeof TriangleAlert; chip: string; rule: string }> = {
  alert: { icon: TriangleAlert, chip: "bg-warning-soft text-warning", rule: "before:bg-warning-fill" },
  weekly: { icon: ChartColumn, chip: "bg-accent-soft text-accent", rule: "before:bg-accent" },
  monthly: { icon: ChartColumn, chip: "bg-accent-soft text-accent", rule: "before:bg-accent" },
};

/** Pastille d'icône d'un message de Claude selon son type (alerte, bilan, réponse). */
export function KindIcon({
  kind,
  size = "md",
  className,
}: {
  kind: MessageKind;
  size?: "md" | "lg";
  className?: string;
}) {
  const style = isProactive(kind) ? kindStyles[kind] : null;
  const Icon = style?.icon ?? Sparkles;
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full",
        size === "lg" ? "size-9" : "size-7",
        style?.chip ?? "bg-accent-soft text-accent",
        className,
      )}
    >
      <Icon className={size === "lg" ? "size-[18px]" : "size-3.5"} />
    </span>
  );
}

function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function Time({ ts, now }: { ts: number; now: number }) {
  return (
    <time dateTime={new Date(ts).toISOString()} title={fullDateTime(ts)} className="num">
      {relativeTime(ts, now)}
    </time>
  );
}

function TelegramTag() {
  return (
    <span className="inline-flex items-center gap-1 text-subtle">
      <Send aria-hidden className="size-3" />
      via Telegram
    </span>
  );
}

function Meta({ children, align = "left" }: { children: ReactNode; align?: "left" | "right" }) {
  return (
    <p className={cn("mt-1 flex items-center gap-2 text-[11px] text-subtle", align === "right" && "justify-end")}>
      {children}
    </p>
  );
}

const itemBase =
  "scroll-mt-4 rounded-2xl transition-[box-shadow,background-color] duration-500 data-[highlight=true]:ring-2 data-[highlight=true]:ring-accent/50 data-[highlight=true]:ring-offset-4 data-[highlight=true]:ring-offset-surface";

function MessageItem({ message, now }: { message: ThreadMessage; now: number }) {
  const unread = message.role === "assistant" && message.readAt === null;
  const common = {
    "data-message-id": message.id,
    "data-unread": unread ? "true" : undefined,
  };

  if (message.role === "divider") {
    return (
      <li {...common} className="flex items-center gap-3 py-1 text-[12px] text-subtle" aria-label="Nouvelle conversation">
        <span aria-hidden className="h-px flex-1 bg-border" />
        <span className="font-medium text-muted">Nouvelle conversation</span>
        <span aria-hidden>·</span>
        <Time ts={message.createdAt} now={now} />
        <span aria-hidden className="h-px flex-1 bg-border" />
      </li>
    );
  }

  if (message.role === "user") {
    return (
      <li {...common} className={cn(itemBase, "flex flex-col items-end")}>
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-sm leading-relaxed text-accent-fg">
          <span className="sr-only">Vous : </span>
          {message.content}
        </div>
        <Meta align="right">
          {message.source === "telegram" && <TelegramTag />}
          <Time ts={message.createdAt} now={now} />
        </Meta>
      </li>
    );
  }

  if (isProactive(message.kind)) {
    const style = kindStyles[message.kind];
    return (
      <li
        {...common}
        className={cn(
          itemBase,
          "relative overflow-hidden border border-border bg-surface pl-5 pr-4 py-3.5 shadow-[0_1px_0_0_var(--border)] sm:pr-5",
          "before:absolute before:inset-y-0 before:left-0 before:w-[3px]",
          style.rule,
        )}
      >
        <div className="mb-2 flex items-center gap-2.5">
          <KindIcon kind={message.kind} />
          <span className="text-[13px] font-semibold tracking-[-0.01em] text-fg">{kindLabel(message.kind)}</span>
          {unread && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-accent">
              <span aria-hidden className="size-1.5 rounded-full bg-accent" />
              Nouveau
            </span>
          )}
          <span className="ml-auto text-[11px] text-subtle">
            <Time ts={message.createdAt} now={now} />
          </span>
        </div>
        <div className="break-words text-sm leading-relaxed text-fg">
          <Markdown text={message.content} />
        </div>
      </li>
    );
  }

  return (
    <li {...common} className={cn(itemBase, "flex items-start gap-3")}>
      <KindIcon kind="chat" className="mt-0.5" />
      <div className="min-w-0 max-w-[85%]">
        <div className="break-words rounded-2xl rounded-tl-md bg-surface-2 px-4 py-3 text-sm leading-relaxed text-fg">
          <span className="sr-only">Claude : </span>
          <Markdown text={message.content} />
        </div>
        <Meta>
          {message.source === "telegram" && <TelegramTag />}
          <Time ts={message.createdAt} now={now} />
        </Meta>
      </div>
    </li>
  );
}

function StreamingBubble({ text, tool }: { text: string; tool: string | null }) {
  return (
    <li className="flex items-start gap-3" aria-busy="true">
      <KindIcon kind="chat" className="mt-0.5" />
      <div className="min-w-0 max-w-[85%] space-y-2">
        {(text !== "" || !tool) && (
          <div className="break-words rounded-2xl rounded-tl-md bg-surface-2 px-4 py-3 text-sm leading-relaxed text-fg">
            {text !== "" ? (
              <Markdown text={text} />
            ) : (
              <span className="flex h-5 items-center gap-1" aria-label="Claude réfléchit">
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
      </div>
    </li>
  );
}

export type PendingUser = { content: string; failed: boolean };
export type ThreadFailure = { message: string; onRetry?: () => void };

export type ThreadViewProps = {
  thread: ThreadState;
  /** Question envoyée pas encore présente dans le fil (affichage immédiat, ou envoi échoué). */
  pending: PendingUser | null;
  /** Réponse en cours de génération. */
  stream: { text: string; tool: string | null } | null;
  failure: ThreadFailure | null;
  /** Message à rejoindre et mettre en évidence, puis `onFocusDone`. */
  focusId: number | null;
  onFocusDone: () => void;
  /** Messages de Claude non lus devenus visibles (onglet visible). */
  onSeen: (ids: number[]) => void;
  onSuggestion?: (text: string) => void;
  /** Incrémenté pour forcer le retour en bas (envoi d'un message). */
  scrollSignal: number;
  className?: string;
  /** Classes du conteneur de lecture (largeur). */
  innerClassName?: string;
};

/** Fil de discussion (panneau et page Assistant) : défilement, pagination, lecture, mise en évidence. */
export function ThreadView({
  thread,
  pending,
  stream,
  failure,
  focusId,
  onFocusDone,
  onSeen,
  onSuggestion,
  scrollSignal,
  className,
  innerClassName,
}: ThreadViewProps) {
  const { messages, status, hasMore, loadingOlder, loadOlder, refreshTail } = thread;
  const now = useNow();
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const focusAttempts = useRef(0);
  const onSeenRef = useRef(onSeen);

  useEffect(() => {
    onSeenRef.current = onSeen;
  }, [onSeen]);

  const olderWithAnchor = useCallback(async () => {
    const el = scrollRef.current;
    if (el) anchor.current = { height: el.scrollHeight, top: el.scrollTop };
    await loadOlder();
  }, [loadOlder]);

  // Défilement : position conservée après un chargement plus ancien, sinon suivi du bas tant
  // que l'utilisateur n'est pas remonté dans le fil.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (anchor.current) {
      el.scrollTop = anchor.current.top + (el.scrollHeight - anchor.current.height);
      anchor.current = null;
    } else if (stick.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, pending, stream, failure, status]);

  useLayoutEffect(() => {
    stick.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [scrollSignal]);

  // `openAt` : rejoindre le message (pages plus anciennes au besoin), puis le mettre en évidence.
  useEffect(() => {
    if (focusId === null || status !== "ready") return;
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-message-id="${focusId}"]`);
    if (el) {
      focusAttempts.current = 0;
      stick.current = false;
      el.scrollIntoView({ block: "center" });
      el.dataset.highlight = "true";
      setTimeout(() => {
        delete el.dataset.highlight;
      }, 2400);
      onFocusDone();
      return;
    }
    if (hasMore && focusAttempts.current < MAX_FOCUS_PAGES && !loadingOlder) {
      focusAttempts.current += 1;
      void loadOlder();
    } else if (!loadingOlder) {
      focusAttempts.current = 0;
      onFocusDone();
    }
  }, [focusId, status, messages, hasMore, loadingOlder, loadOlder, onFocusDone]);

  // Lecture : un message de Claude non lu est « lu » dès qu'il est visible à moitié.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || status !== "ready") return;
    let observer: IntersectionObserver | null = null;
    const start = () => {
      observer?.disconnect();
      if (document.visibilityState !== "visible") return;
      observer = new IntersectionObserver(
        (entries) => {
          const ids = entries
            .filter(
              (e) =>
                e.isIntersecting &&
                isSeen({
                  ratio: e.intersectionRatio,
                  visibleHeight: e.intersectionRect.height,
                  rootHeight: e.rootBounds?.height ?? root.clientHeight,
                }),
            )
            .map((e) => Number((e.target as HTMLElement).dataset.messageId))
            .filter((id) => Number.isInteger(id));
          if (ids.length && document.visibilityState === "visible") onSeenRef.current(ids);
        },
        // Seuils fins : un message plus haut que la zone n'atteint jamais 40 % ; il est vu
        // quand il en occupe la moitié (voir `isSeen`).
        { root, threshold: SEEN_THRESHOLDS },
      );
      root.querySelectorAll('[data-unread="true"]').forEach((el) => observer?.observe(el));
    };
    start();
    document.addEventListener("visibilitychange", start);
    return () => {
      document.removeEventListener("visibilitychange", start);
      observer?.disconnect();
    };
  }, [messages, status]);

  const empty = status === "ready" && messages.length === 0 && !pending && !stream;

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      }}
      className={cn("overflow-y-auto overscroll-contain", className)}
    >
      <div className={cn("mx-auto flex min-h-full w-full flex-col", innerClassName)}>
        {status === "loading" && (
          <div className="space-y-4 py-2" aria-label="Chargement du fil" aria-busy="true">
            {[60, 80, 45].map((w, i) => (
              <div
                key={w}
                className={cn("h-12 animate-pulse rounded-2xl bg-surface-2", i % 2 === 0 ? "ml-auto" : "")}
                style={{ width: `${w}%` }}
              />
            ))}
          </div>
        )}

        {status === "error" && (
          <div role="alert" className="flex flex-col items-center gap-3 py-12 text-center text-[13px] text-muted">
            <CircleAlert aria-hidden className="size-5 text-danger" />
            <p>Impossible de charger la conversation.</p>
            <Button variant="secondary" size="sm" onClick={() => void refreshTail()}>
              <RotateCcw aria-hidden />
              Réessayer
            </Button>
          </div>
        )}

        {empty && <Welcome onPick={onSuggestion} />}

        {status === "ready" && !empty && (
          <>
            {hasMore && (
              <div className="mb-5 flex justify-center">
                <Button variant="ghost" size="sm" onClick={() => void olderWithAnchor()} loading={loadingOlder}>
                  {!loadingOlder && <ChevronUp aria-hidden />}
                  Charger les messages précédents
                </Button>
              </div>
            )}
            <ol aria-label="Conversation avec Claude" className="space-y-5">
              {messages.map((m) => (
                <MessageItem key={m.id} message={m} now={now} />
              ))}
              {pending && (
                <li className="flex flex-col items-end">
                  <div
                    className={cn(
                      "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md px-4 py-2.5 text-sm leading-relaxed",
                      pending.failed ? "border border-dashed border-border-strong bg-surface text-fg" : "bg-accent text-accent-fg",
                    )}
                  >
                    <span className="sr-only">Vous : </span>
                    {pending.content}
                  </div>
                  {pending.failed && <Meta align="right">Non envoyé</Meta>}
                </li>
              )}
              {stream && <StreamingBubble text={stream.text} tool={stream.tool} />}
              {failure && (
                <li
                  role="alert"
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-danger"
                >
                  <CircleAlert aria-hidden className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1">{failure.message}</span>
                  {failure.onRetry && (
                    <Button variant="secondary" size="sm" onClick={failure.onRetry}>
                      <RotateCcw aria-hidden />
                      Réessayer
                    </Button>
                  )}
                </li>
              )}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}

function Welcome({ onPick }: { onPick?: (q: string) => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-8 text-center">
      <span className="inline-flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Sparkles aria-hidden className="size-6" />
      </span>
      <div className="max-w-sm space-y-1.5">
        <h2 className="text-[15px] font-semibold text-fg">Posez une question à Claude sur vos finances</h2>
        <p className="text-[13px] leading-relaxed text-muted">
          Claude consulte vos comptes, transactions, budgets, investissements et objectifs, en lecture seule. Ses
          alertes et bilans arrivent aussi ici.
        </p>
      </div>
      {onPick && (
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
      )}
    </div>
  );
}
