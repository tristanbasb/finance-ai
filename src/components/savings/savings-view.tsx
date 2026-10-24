"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarDays, CircleCheck, Pencil, PiggyBank, Plus, Target } from "lucide-react";
import { Amount } from "@/components/amount";
import { CategoryIcon } from "@/components/category-icon";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Progress } from "@/components/ui/progress";
import { formatDateFull, formatPercent } from "@/lib/format";
import { goalProgress } from "@/lib/finance";
import { formatEUR } from "@/lib/money";
import { GoalDialog, type GoalAccountOption, type GoalView } from "./goal-dialog";

export type SavingsAccount = { id: number; name: string; color: string; balance: number };

export type SavingsViewProps = {
  /** Comptes d'épargne actifs (cartes du haut). */
  savingsAccounts: SavingsAccount[];
  /** Comptes auxquels un objectif peut être rattaché (épargne, courant, autre). */
  goalAccounts: GoalAccountOption[];
  goals: GoalView[];
  /** Date du jour « YYYY-MM-DD », fournie par le serveur pour éviter tout écart d'hydratation. */
  today: string;
};

type DialogState = { nonce: number; open: boolean; goal: GoalView | null };

/** Écran Épargne : synthèse, comptes d'épargne et objectifs avec leur rythme mensuel. */
export function SavingsView({ savingsAccounts, goalAccounts, goals, today }: SavingsViewProps) {
  const [dialog, setDialog] = useState<DialogState>({ nonce: 0, open: false, goal: null });
  const openAdd = () => setDialog((d) => ({ nonce: d.nonce + 1, open: true, goal: null }));
  const openEdit = (goal: GoalView) => setDialog((d) => ({ nonce: d.nonce + 1, open: true, goal }));
  const closeDialog = () => setDialog((d) => ({ ...d, open: false }));

  const totalSavings = savingsAccounts.reduce((sum, a) => sum + a.balance, 0);
  const remaining = goals.reduce(
    (sum, g) => sum + goalProgress({ target: g.targetAmount, current: g.current, deadline: g.deadline }, today).remaining,
    0,
  );

  return (
    <div className="space-y-5 sm:space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <p className="text-[13px] text-muted">
            {goals.length === 0 ? "Aucun objectif" : `${goals.length} ${goals.length > 1 ? "objectifs" : "objectif"}`}
          </p>
          <h1 className="text-2xl font-semibold tracking-[-0.025em] text-fg sm:text-[28px]">Épargne</h1>
        </div>
        <Button onClick={openAdd}>
          <Plus aria-hidden />
          Nouvel objectif
        </Button>
      </header>

      <Card className="grid grid-cols-3 divide-x divide-border">
        <Total label="Épargne totale" value={<Amount cents={totalSavings} />} />
        <Total label="Objectifs" value={<span className="num">{goals.length}</span>} />
        <Total label="Reste à épargner" value={<Amount cents={remaining} />} />
      </Card>

      <section aria-labelledby="savings-accounts" className="space-y-3">
        <h2 id="savings-accounts" className="px-1 text-[15px] font-semibold tracking-[-0.01em] text-fg">
          Comptes d&apos;épargne
        </h2>
        {savingsAccounts.length === 0 ? (
          <EmptyState
            icon={PiggyBank}
            title="Aucun compte d'épargne"
            description="Créez un compte de type Épargne (Livret A, LDDS…) pour suivre votre capital."
            action={
              <Link href="/settings#comptes" className={buttonClasses({ variant: "secondary", size: "sm" })}>
                Ouvrir les réglages
              </Link>
            }
          />
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {savingsAccounts.map((a) => (
              <li key={a.id}>
                <Card className="flex items-center gap-3.5 p-4 sm:p-5">
                  <CategoryIcon icon="piggy-bank" color={a.color} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">{a.name}</p>
                    <p className="text-[12px] text-muted">Solde</p>
                  </div>
                  <Amount cents={a.balance} className="shrink-0 text-lg font-semibold tracking-[-0.02em] text-fg" />
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="savings-goals" className="space-y-3">
        <h2 id="savings-goals" className="px-1 text-[15px] font-semibold tracking-[-0.01em] text-fg">
          Objectifs
        </h2>
        {goals.length === 0 ? (
          <EmptyState
            icon={Target}
            title="Aucun objectif pour l'instant"
            description="Fixez un montant à atteindre et une échéance : nous calculons l'effort mensuel nécessaire."
            action={
              <Button onClick={openAdd}>
                <Plus aria-hidden />
                Créer un objectif
              </Button>
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
      </section>

      <GoalDialog
        key={`goal-${dialog.nonce}`}
        open={dialog.open}
        onClose={closeDialog}
        accounts={goalAccounts}
        goal={dialog.goal}
      />
    </div>
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
          <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: goal.color }} />
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
            Objectif atteint 🎉
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

function Total({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1 px-4 py-3.5 sm:px-6 sm:py-4">
      <p className="text-[12px] font-medium text-muted sm:text-[13px]">{label}</p>
      <p className="num text-base font-semibold tracking-[-0.02em] text-fg sm:text-xl">{value}</p>
    </div>
  );
}
