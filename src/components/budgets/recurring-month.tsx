"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  CalendarClock,
  Check,
  CircleCheck,
  Clock,
  Info,
  Plus,
  Settings2,
  SkipForward,
  Undo2,
  X,
} from "lucide-react";
import { CategoryIcon } from "@/components/category-icon";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import type { MonthRecurring, RecurringStatus } from "@/lib/forecast";
import { RECURRING_STATUS_LABELS } from "@/lib/forecast-ui";
import { errorMessage } from "@/lib/http";
import { formatEUR } from "@/lib/money";
import { frequencyLabel } from "@/lib/settings-ui";
import { PayDialog, type PayAccount } from "./pay-dialog";

export type MonthRecurringRow = MonthRecurring & {
  categoryColor: string | null;
  categoryIcon: string | null;
  /** Raison de l'exclusion de la prévision (à payer sur un compte non courant), sinon null. */
  hint: string | null;
};

const STATUS_BADGE: Record<RecurringStatus, { variant: BadgeVariant; icon: typeof Clock }> = {
  due: { variant: "accent", icon: Clock },
  paid: { variant: "positive", icon: CircleCheck },
  skipped: { variant: "neutral", icon: SkipForward },
};

const MANAGE_HREF = "/settings#recurrentes";

function summary(items: MonthRecurringRow[]): string {
  const count = (s: RecurringStatus) => items.filter((i) => i.status === s).length;
  const parts = [
    [count("due"), "à payer", "à payer"],
    [count("paid"), "payée", "payées"],
    [count("skipped"), "passée", "passées"],
  ] as const;
  return parts
    .filter(([n]) => n > 0)
    .map(([n, one, many]) => `${n} ${n > 1 ? many : one}`)
    .join(" · ");
}

/** « Récurrentes du mois » (Budgets, mois courant) : statut, validation, saut et annulation. */
export function RecurringMonth({
  period,
  items,
  hasRecurring,
  accounts,
  className,
}: {
  period: string;
  items: MonthRecurringRow[];
  /** Au moins une récurrente déclarée (même si aucune ne tombe ce mois-ci). */
  hasRecurring: boolean;
  accounts: PayAccount[];
  className?: string;
}) {
  const [pay, setPay] = useState<{ nonce: number; item: MonthRecurringRow | null }>({ nonce: 0, item: null });
  const [undo, setUndo] = useState<MonthRecurringRow | null>(null);

  return (
    <Card className={className}>
      <CardHeader
        action={
          hasRecurring && (
            <Link href={MANAGE_HREF} className={buttonClasses({ variant: "secondary", size: "sm" })}>
              <Settings2 aria-hidden />
              Gérer
            </Link>
          )
        }
      >
        <CardTitle className="flex items-center gap-2">
          <CalendarClock aria-hidden className="size-4 text-brand" />
          Récurrentes du mois
        </CardTitle>
        <CardDescription>
          {items.length > 0 ? summary(items) : "Loyer, abonnements, assurances : ce qui revient chaque mois."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!hasRecurring ? (
          <EmptyState
            icon={CalendarClock}
            title="Déclarez vos dépenses récurrentes"
            description="Loyer, abonnements, assurances : ajoutez-les pour savoir ce qu'il vous restera en fin de mois."
            action={
              <Link href={MANAGE_HREF} className={buttonClasses({ variant: "primary", size: "sm" })}>
                <Plus aria-hidden />
                Déclarer mes récurrentes
              </Link>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={CircleCheck}
            title="Rien à prévoir ce mois-ci"
            description="Vos dépenses trimestrielles ou annuelles apparaîtront le mois de leur échéance."
          />
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <RecurringItem
                key={item.id}
                item={item}
                period={period}
                onPay={() => setPay((p) => ({ nonce: p.nonce + 1, item }))}
                onUndoPaid={() => setUndo(item)}
              />
            ))}
          </ul>
        )}
      </CardContent>

      {pay.item && (
        <PayDialog
          key={`pay-${pay.nonce}`}
          open
          onClose={() => setPay((p) => ({ ...p, item: null }))}
          period={period}
          item={pay.item}
          accounts={accounts}
        />
      )}
      <UndoPaidDialog item={undo} period={period} onClose={() => setUndo(null)} />
    </Card>
  );
}

/** Supprime le paiement ou le saut du mois ; `true` si c'est fait. */
async function deletePayment(id: number, period: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/recurring/${id}/payments/${period}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Annulation impossible", { description: await errorMessage(res) });
      return false;
    }
    return true;
  } catch {
    toast.error("Annulation impossible", { description: "Le serveur est injoignable." });
    return false;
  }
}

function RecurringItem({
  item,
  period,
  onPay,
  onUndoPaid,
}: {
  item: MonthRecurringRow;
  period: string;
  onPay: () => void;
  onUndoPaid: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"skip" | "undo" | null>(null);
  const badge = STATUS_BADGE[item.status];
  const BadgeIcon = badge.icon;
  const settled = item.status !== "due";

  async function skip() {
    setBusy("skip");
    try {
      const res = await fetch(`/api/recurring/${item.id}/skip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period }),
      });
      if (!res.ok) {
        toast.error("Impossible de passer ce mois", { description: await errorMessage(res) });
        if (res.status === 409) router.refresh();
        return;
      }
      toast.success("Passée pour ce mois", { description: item.label });
      router.refresh();
    } catch {
      toast.error("Impossible de passer ce mois", { description: "Le serveur est injoignable." });
    } finally {
      setBusy(null);
    }
  }

  async function undoSkip() {
    setBusy("undo");
    if (await deletePayment(item.id, period)) {
      toast.success("Validation annulée", { description: item.label });
      router.refresh();
    }
    setBusy(null);
  }

  return (
    <li className="space-y-3 py-4 first:pt-0 last:pb-0">
      <div className="flex items-center gap-3">
        <CategoryIcon
          icon={item.categoryIcon}
          color={item.categoryColor}
          size="md"
          tinted
          className={cn(item.status === "skipped" && "opacity-50")}
        />
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className={cn("truncate text-[15px] font-semibold", settled ? "text-muted" : "text-fg")}>{item.label}</p>
          <p className="text-[12px] text-muted">
            {item.categoryName ?? "Sans catégorie"} · {frequencyLabel(item.frequency, item.anchorMonth)}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            className={cn(
              "num text-[15px] font-semibold",
              item.status === "skipped" ? "text-subtle line-through" : settled ? "text-muted" : "text-fg",
            )}
          >
            {formatEUR(item.amount)}
          </span>
          <Badge variant={badge.variant}>
            <BadgeIcon aria-hidden />
            {RECURRING_STATUS_LABELS[item.status]}
          </Badge>
        </div>
      </div>

      {item.hint && (
        <p className="flex items-center gap-1.5 text-[12px] text-muted">
          <Info aria-hidden className="size-3.5 shrink-0 text-warning" />
          {item.hint}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {item.status === "due" ? (
          <>
            <Button variant="secondary" size="sm" onClick={skip} loading={busy === "skip"}>
              {busy !== "skip" && <SkipForward aria-hidden />}
              Passer ce mois
            </Button>
            <Button size="sm" onClick={onPay} disabled={busy !== null}>
              <Check aria-hidden />
              Valider
            </Button>
          </>
        ) : (
          <>
            {item.status === "paid" && (
              <Link
                href={`/transactions?month=${period}&q=${encodeURIComponent(item.label)}`}
                className={buttonClasses({ variant: "ghost", size: "sm" })}
              >
                <ArrowUpRight aria-hidden />
                Voir dans l&apos;Activité
              </Link>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={item.status === "paid" ? onUndoPaid : undoSkip}
              loading={busy === "undo"}
              aria-label={`Annuler : ${item.label} ${item.status === "paid" ? "payée" : "passée"}`}
            >
              {busy !== "undo" && <Undo2 aria-hidden />}
              Annuler
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

/** Confirmation avant d'annuler une validation : l'opération créée sera supprimée. */
function UndoPaidDialog({
  item,
  period,
  onClose,
}: {
  item: MonthRecurringRow | null;
  period: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (!item) return;
    setBusy(true);
    if (await deletePayment(item.id, period)) {
      toast.success("Validation annulée", { description: `${item.label} : opération supprimée` });
      onClose();
      router.refresh();
    }
    setBusy(false);
  }

  return (
    <Dialog
      open={item !== null}
      onClose={onClose}
      size="sm"
      title="Annuler la validation ?"
      description={
        item
          ? `L'opération « ${item.label} » sera supprimée de l'Activité et la dépense redeviendra à payer.`
          : undefined
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            <X aria-hidden />
            Conserver
          </Button>
          <Button variant="danger" onClick={confirm} loading={busy}>
            {!busy && <Undo2 aria-hidden />}
            Annuler la validation
          </Button>
        </>
      }
    />
  );
}
