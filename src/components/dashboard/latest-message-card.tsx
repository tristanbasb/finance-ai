"use client";

import { useEffect, useState } from "react";
import { ArrowRight, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAssistant } from "@/components/assistant/assistant-provider";
import { KindIcon } from "@/components/assistant/thread";
import { excerpt, fullDateTime, kindLabel, relativeTime, type ThreadMessage } from "@/lib/assistant-thread";
import { cn } from "@/lib/cn";

/**
 * « Dernier message de Claude » en tête du tableau de bord : dernière alerte ou dernier bilan,
 * avec ouverture du fil sur ce message ; à défaut, une invitation à poser une question.
 */
export function LatestMessageCard({ message }: { message: ThreadMessage | null }) {
  const { openAt, setOpen, unread: unreadState } = useAssistant();
  // Date relative calculée après l'hydratation (l'heure du serveur peut différer).
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setNow(Date.now()), 0);
    const i = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      clearTimeout(t);
      clearInterval(i);
    };
  }, []);

  if (!message) {
    return (
      <section
        aria-label="Assistant"
        className="flex flex-col gap-3 rounded-2xl border border-border bg-surface px-5 py-4 sm:flex-row sm:items-center sm:px-6"
      >
        <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
            <MessageCircle aria-hidden className="size-[18px]" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-fg">
              Posez une question à Claude sur vos finances
            </h2>
            <p className="text-[13px] text-muted">Ses alertes et bilans de la semaine et du mois s&apos;afficheront ici.</p>
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)} className="ml-12 self-start sm:ml-0 sm:self-auto">
          Écrire à Claude
          <ArrowRight aria-hidden />
        </Button>
      </section>
    );
  }

  // Lu depuis le rendu serveur (panneau, cloche) : la liste des non-lus fait foi une fois chargée.
  const unread =
    message.readAt === null &&
    (!unreadState.loaded ||
      unreadState.latest.some((m) => m.id === message.id) ||
      unreadState.count > unreadState.latest.length);
  const alert = message.kind === "alert";
  return (
    <section
      aria-label="Dernier message de Claude"
      className={cn(
        "relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-border bg-surface py-4 pl-6 pr-5 sm:flex-row sm:items-center sm:pr-6",
        "before:absolute before:inset-y-0 before:left-0 before:w-[3px]",
        alert ? "before:bg-warning-fill" : "before:bg-accent",
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
        <KindIcon kind={message.kind} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2 text-[12px] text-subtle">
            <span className="font-medium text-muted">Dernier message de Claude</span>
            <span aria-hidden>·</span>
            <time dateTime={new Date(message.createdAt).toISOString()} title={now === null ? undefined : fullDateTime(message.createdAt)}>
              {now === null ? " " : relativeTime(message.createdAt, now)}
            </time>
            {unread && (
              <span className="inline-flex items-center gap-1 font-medium text-accent">
                <span aria-hidden className="size-1.5 rounded-full bg-accent" />
                Non lu
              </span>
            )}
          </p>
          <h2 className="mt-0.5 text-[14px] font-semibold tracking-[-0.01em] text-fg">{kindLabel(message.kind)}</h2>
          <p className="mt-0.5 line-clamp-2 text-[13px] leading-relaxed text-muted">{excerpt(message.content, 220)}</p>
        </div>
      </div>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => openAt(message.id)}
        className="ml-12 self-start sm:ml-0 sm:self-auto"
        aria-label={`Ouvrir le message : ${kindLabel(message.kind)}`}
      >
        Ouvrir
        <ArrowRight aria-hidden />
      </Button>
    </section>
  );
}
