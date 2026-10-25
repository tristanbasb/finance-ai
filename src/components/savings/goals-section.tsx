"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarDays, CircleCheck, Pencil, Plus, Target } from "lucide-react";
import { Amount } from "@/components/amount";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Progress } from "@/components/ui/progress";
import { tintStyle } from "@/lib/category-tint";
import { formatDateFull, formatPercent } from "@/lib/format";
import { goalProgress } from "@/lib/finance";
import { formatEUR } from "@/lib/money";
import { GoalDialog, type GoalAccountOption, type GoalView } from "./goal-dialog";

export type GoalsSectionProps = {
  /** Comptes auxquels un objectif peut être rattaché (épargne, courant, autre). */
  goalAccounts: GoalAccountOption[];
  goals: GoalView[];
  /** Date du jour « YYYY-MM-DD », fournie par le serveur pour éviter tout écart d'hydratation. */
  today: string;
};

type DialogState = { nonce: number; open: boolean; goal: GoalView | null };

/** Section « Objectifs » : cartes de progression avec rythme mensuel, création et modification. */
export function GoalsSection({ goalAccounts, goals, today }: GoalsSectionProps) {
  const [dialog, setDialog] = useState<DialogState>({ nonce: 0, open: false, goal: null });
  const openAdd = () => setDialog((d) => ({ nonce: d.nonce + 1, open: true, goal: null }));
  const openEdit = (goal: GoalView) => setDialog((d) => ({ nonce: d.nonce + 1, open: true, goal }));
  const closeDialog = () => setDialog((d) => ({ ...d, open: false }));

  const remaining = goals.reduce(
    (sum, g) => sum + goalProgress({ target: g.targetAmount, current: g.current, deadline: g.deadline }, today).remaining,
    0,
  );

  return (
    <section id="objectifs" aria-labelledby="patrimoine-objectifs" className="scroll-mt-32 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-0.5 px-1">
          <h2 id="patrimoine-objectifs" className="text-xl font-semibold tracking-[-0.02em] text-fg">
            Objectifs
          </h2>
          {goals.length > 0 && (
            <p className="text-[13px] text-muted">
              Reste à épargner : <Amount cents={remaining} className="font-semibold text-fg" />
            </p>
          )}
        </div>
        <Button size="sm" variant={goals.length === 0 ? "secondary" : "primary"} onClick={openAdd}>
          <Plus aria-hidden />
          Nouvel objectif
        </Button>
      </div>

      {goals.length === 0 ? (
        <EmptyState
          icon={Target}
          title="Aucun objectif pour l'instant"
          description="Fixez un montant à atteindre et une échéance : nous calculons l'effort mensuel nécessaire."
          action={
            goalAccounts.length === 0 ? (
              <Link href="/settings#comptes" className={buttonClasses({ variant: "secondary" })}>
                Créer un compte d&apos;abord
              </Link>
            ) : (
              <Button onClick={openAdd}>
                <Plus aria-hidden />
                Créer un objectif
              </Button>
            )
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {goals.map((g) => (
            <li key={g.id}>
              <GoalCard goal={g} today={today} accountName={goalAccounts.find((a) => a.id === g.accountId)?.name} onEdit={() => openEdit(g)} />
            </li>
          ))}
        </ul>
      )}

      <GoalDialog
        key={`goal-${dialog.nonce}`}
        open={dialog.open}
        onClose={closeDialog}
        accounts={goalAccounts}
        goal={dialog.goal}
      />
    </section>
  );
}

function GoalCard({
  goal,
  today,
  accountName,
  onEdit,
}: {
  goal: GoalView;
  today: string;
  accountName?: string;
  onEdit: () => void;
}) {
  const { pct, remaining, monthlyNeeded } = goalProgress(
    { target: goal.targetAmount, current: goal.current, deadline: goal.deadline },
    today,
  );
  const reached = remaining === 0;
  const overdue = !reached && goal.deadline !== null && goal.deadline < today;

  return (
    <Card className="flex h-full flex-col gap-4 p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden style={tintStyle(goal.color)} className="tint inline-flex size-9 shrink-0 items-center justify-center rounded-full"><Target className="size-4" /></span>
          <h3 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-fg">{goal.name}</h3>
        </div>
        <Button variant="ghost" size="icon" className="-mr-2 -mt-1.5 size-8" onClick={onEdit} aria-label={`Modifier l'objectif ${goal.name}`}>
          <Pencil aria-hidden />
        </Button>
      </div>

      <div className="space-y-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="num min-w-0 truncate">
            <span className="text-xl font-semibold tracking-[-0.02em] text-fg">{formatEUR(goal.current)}</span>
            <span className="text-[13px] text-muted"> / {formatEUR(goal.targetAmount)}</span>
          </p>
          <span className="num shrink-0 text-[13px] font-medium text-muted">{formatPercent(pct)}</span>
        </div>
        <Progress
          value={pct}
          color={goal.color}
          label={`Progression de l'objectif ${goal.name}`}
          valueText={`${formatPercent(pct)} de ${formatEUR(goal.targetAmount)}`}
        />
      </div>

      <div className="mt-auto space-y-1.5 text-[13px]">
        <p className="flex items-center gap-1.5 text-muted">
          <CalendarDays aria-hidden className="size-3.5 shrink-0" />
          {goal.deadline ? (
            <>
              <span>Échéance : {formatDateFull(goal.deadline)}</span>
              {overdue && <Badge variant="warning">Échéance dépassée</Badge>}
            </>
          ) : (
            <span>Sans échéance</span>
          )}
        </p>
        {reached ? (
          <p className="flex items-center gap-1.5 font-medium text-positive">
            <CircleCheck aria-hidden className="size-3.5 shrink-0" />
            Objectif atteint
          </p>
        ) : (
          monthlyNeeded !== null && (
            <p className="text-fg">
              <span className="num font-semibold">{formatEUR(monthlyNeeded)}/mois</span>
              <span className="text-muted"> pour atteindre l&apos;objectif</span>
            </p>
          )
        )}
        {accountName && <p className="text-[12px] text-subtle">Suit le solde du compte {accountName}</p>}
      </div>
    </Card>
  );
}
