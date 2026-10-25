"use client";

import { useEffect, useState } from "react";
import { ArrowRight, MessageCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAssistant } from "@/components/assistant/assistant-provider";
import { KindIcon } from "@/components/assistant/thread";
import { excerpt, fullDateTime, kindLabel, relativeTime, type ThreadMessage } from "@/lib/assistant-thread";
import { cn } from "@/lib/cn";

/**
 * « Dernier message de Claude » sur l'accueil : dernière alerte ou dernier bilan en carte teintée,
 * avec ouverture du fil sur ce message ; à défaut, une invitation à poser une question (panneau,
 * ou saisie de la colonne Claude si elle est affichée).
 */
export function LatestMessageCard({ message, className }: { message: ThreadMessage | null; className?: string }) {
  const { openAt, setOpen, columnVisible, unread: unreadState } = useAssistant();
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

  // Colonne Claude affichée : la saisie y est déjà, on y place le curseur.
  const ask = () => {
    if (columnVisible) document.querySelector<HTMLElement>("[data-claude-column-frame] textarea")?.focus();
    else setOpen(true);
  };

  if (!message) {
    return (
      <section aria-label="Assistant" className={cn("@container rounded-card bg-brand-soft p-4 sm:p-5", className)}>
        <div className="flex flex-col gap-3 @md:flex-row @md:items-center">
          <div className="flex min-w-0 flex-1 items-start gap-3 @md:items-center">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-white">
              <Sparkles aria-hidden className="size-[18px]" />
            </span>
            <div className="min-w-0">
              <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-fg">Posez une question à Claude</h2>
              <p className="text-[13px] text-muted">
                Sur vos dépenses, vos budgets ou votre épargne. Ses alertes et bilans s&apos;afficheront ici.
              </p>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={ask} className="ml-12 self-start @md:ml-0 @md:self-auto">
            <MessageCircle aria-hidden />
            Écrire à Claude
          </Button>
        </div>
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
      className={cn("@container rounded-card p-4 sm:p-5", alert ? "bg-warning-soft" : "bg-brand-soft", className)}
    >
      <div className="flex flex-col gap-3 @md:flex-row @md:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3 @md:items-center">
          <KindIcon kind={message.kind} size="lg" className="ring-1 ring-current/25" />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-baseline gap-x-2 text-[12px] text-subtle">
              <span className="font-medium text-muted">Dernier message de Claude</span>
              <span aria-hidden>·</span>
              <time
                dateTime={new Date(message.createdAt).toISOString()}
                title={now === null ? undefined : fullDateTime(message.createdAt)}
              >
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
            <p className="mt-0.5 line-clamp-2 text-[13px] leading-relaxed text-muted">
              {excerpt(message.content, 220)}
            </p>
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => openAt(message.id)}
          className="ml-12 self-start @md:ml-0 @md:self-auto"
          aria-label={`Ouvrir le message : ${kindLabel(message.kind)}`}
        >
          Ouvrir
          <ArrowRight aria-hidden />
        </Button>
      </div>
    </section>
  );
}
