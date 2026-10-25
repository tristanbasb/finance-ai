"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  ChartLine,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Gauge,
  Info,
  Landmark,
  PencilLine,
  RotateCcw,
  Shapes,
  Tags,
  Target,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  actionDisplayState,
  actionKind,
  actionSummaryText,
  actionTime,
  undoUntil,
  type ActionIconName,
  type ActionTone,
  type ActionView,
} from "@/lib/ai-actions-ui";
import { fullDateTime } from "@/lib/assistant-thread";
import { errorMessage } from "@/lib/http";
import { cn } from "@/lib/cn";

const ICONS: Record<ActionIconName, LucideIcon> = {
  ArrowLeftRight,
  Tags,
  Gauge,
  Shapes,
  Target,
  Landmark,
  ChartLine,
  PencilLine,
};

const TONES: Record<ActionTone, string> = {
  accent: "bg-accent-soft text-accent",
  positive: "bg-positive-soft text-positive",
  warning: "bg-warning-soft text-warning",
};

/** Retour local d'une annulation : réussie, ou refusée par le serveur (409) avec sa raison. */
type Outcome = { kind: "undone" } | { kind: "refused"; reason: string };

/**
 * Carte d'une modification faite par Claude, sous sa réponse : type, résumé, détail repliable et
 * bouton « Annuler » (24 h). `onChanged` relit le fil et les statuts après une annulation.
 */
export function ActionCard({ action, now, onChanged }: { action: ActionView; now: number; onChanged: () => void }) {
  const router = useRouter();
  const detailId = useId();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const kind = actionKind(action.tool, action.summary);
  const Icon = ICONS[kind.icon];
  const display =
    outcome?.kind === "undone"
      ? actionDisplayState({ undoneAt: now, undoable: false })
      : outcome?.kind === "refused"
        ? actionDisplayState({ undoneAt: null, undoable: false, reason: outcome.reason })
        : actionDisplayState(action, { createdAt: action.createdAt, now });
  const undone = display.state === "undone";
  const reason = "reason" in display ? display.reason : null;

  async function undo() {
    setPending(true);
    try {
      const res = await fetch(`/api/ai/actions/${action.id}/undo`, { method: "POST" });
      if (res.ok) {
        setOutcome({ kind: "undone" });
        toast.success("Action annulée", { description: action.summary });
        // Données modifiées : seule une annulation réussie rafraîchit la page.
        router.refresh();
      } else if (res.status === 409 || res.status === 404) {
        const why = res.status === 404 ? "Action introuvable." : await errorMessage(res);
        if (actionDisplayState({ undoneAt: null, undoable: false, reason: why }).state === "undone") {
          // Déjà annulée ailleurs (Telegram par exemple) : le résultat voulu est atteint.
          setOutcome({ kind: "undone" });
          toast("Action déjà annulée", { description: action.summary });
        } else {
          setOutcome({ kind: "refused", reason: why });
          toast.error("Annulation impossible", { description: why });
        }
      } else {
        toast.error("Annulation impossible", { description: await errorMessage(res) });
        return;
      }
      onChanged();
    } catch {
      toast.error("Annulation impossible", { description: "Le serveur ne répond pas. Réessayez." });
    } finally {
      setPending(false);
    }
  }

  return (
    <article
      aria-label={`${kind.label} : ${action.summary}`}
      className={cn(
        "rounded-xl border border-border bg-surface px-3 py-2.5 shadow-soft transition-opacity duration-200",
        undone && "bg-surface-2 shadow-none",
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className={cn(
            "mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full",
            undone ? "bg-border text-subtle" : TONES[kind.tone],
          )}
        >
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-subtle">
            <span className="font-semibold uppercase tracking-[0.04em] text-muted">{kind.label}</span>
            <span aria-hidden>·</span>
            <time dateTime={new Date(action.createdAt).toISOString()} title={fullDateTime(action.createdAt)} className="num">
              {actionTime(action.createdAt, now)}
            </time>
          </p>
          <p className={cn("mt-0.5 break-words text-[13px] leading-snug text-fg", undone && "text-muted line-through decoration-subtle")}>
            {actionSummaryText(action.summary, kind.label)}
          </p>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pl-[2.375rem]">
        {action.items.length > 0 ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={detailId}
            onClick={() => setOpen((o) => !o)}
            className={cn(
              "-ml-2 inline-flex h-8 items-center gap-1 rounded-full px-2 text-[12px] font-medium text-muted pointer-coarse:h-11",
              "transition-colors hover:bg-surface-2 hover:text-fg",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            )}
          >
            <ChevronDown aria-hidden className={cn("size-3.5 transition-transform duration-150", open && "rotate-180")} />
            {open ? "Masquer" : `Détail (${action.items.length})`}
          </button>
        ) : (
          <span />
        )}

        <div aria-live="polite" className="flex items-center">
          {display.state === "undoable" ? (
            <Button variant="secondary" size="sm" onClick={() => void undo()} loading={pending}>
              {!pending && <Undo2 aria-hidden />}
              {pending ? "Annulation…" : "Annuler"}
            </Button>
          ) : undone ? (
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-positive-soft px-3 text-[12px] font-semibold text-positive">
              <CircleCheck aria-hidden className="size-3.5" />
              {display.label}
            </span>
          ) : (
            <Button variant="secondary" size="sm" disabled aria-describedby={`${detailId}-reason`}>
              <Undo2 aria-hidden />
              Annuler
            </Button>
          )}
        </div>
      </div>

      {display.state === "undoable" && (
        <p className="mt-1.5 pl-[2.375rem] text-[11px] text-subtle">Annulable {undoUntil(action.createdAt, now)}</p>
      )}

      {reason && (
        <p
          id={`${detailId}-reason`}
          className="mt-2 ml-[2.375rem] flex items-start gap-1.5 rounded-lg bg-warning-soft px-2.5 py-1.5 text-[12px] leading-snug text-warning"
        >
          <Info aria-hidden className="mt-px size-3.5 shrink-0" />
          <span className="min-w-0">{reason}</span>
        </p>
      )}

      {action.items.length > 0 && (
        <ul id={detailId} hidden={!open} className="mt-2 ml-[2.375rem] space-y-1 border-l-2 border-border pl-3 text-[12px] leading-snug text-muted">
          {action.items.map((item, i) => (
            <li key={i} className="break-words">
              {item}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

/** Statuts des actions d'un message : chargement, échec, ou cartes. */
export function ActionCards({
  ids,
  views,
  status,
  now,
  onChanged,
  onRetry,
}: {
  ids: number[];
  views: Map<number, ActionView>;
  status: "loading" | "ready" | "error";
  now: number;
  onChanged: () => void;
  onRetry: () => void;
}) {
  const shown = ids.map((id) => views.get(id)).filter((v): v is ActionView => v !== undefined);
  const count = ids.length;
  const plural = count > 1 ? "s" : "";

  if (shown.length === 0 && status === "loading") {
    return (
      <div className="mt-2 space-y-2" aria-busy="true" aria-label={`Chargement de ${count} modification${plural}`}>
        {ids.map((id) => (
          <div key={id} className="h-[72px] animate-pulse rounded-xl border border-border bg-surface-2" />
        ))}
      </div>
    );
  }

  if (shown.length === 0 && status === "error") {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-surface px-3 py-2.5 text-[12px] text-muted">
        <CircleAlert aria-hidden className="size-3.5 shrink-0 text-danger" />
        <span className="min-w-0 flex-1">
          {count} modification{plural} : détail indisponible.
        </span>
        <Button variant="ghost" size="sm" onClick={onRetry}>
          <RotateCcw aria-hidden />
          Réessayer
        </Button>
      </div>
    );
  }

  if (shown.length === 0) return null;

  return (
    <ul aria-label={`Modifications faites par Claude (${shown.length})`} className="mt-2 space-y-2">
      {shown.map((action) => (
        <li key={action.id}>
          <ActionCard action={action} now={now} onChanged={onChanged} />
        </li>
      ))}
    </ul>
  );
}
