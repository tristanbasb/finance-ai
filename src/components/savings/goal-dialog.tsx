"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/http";
import { formatEUR, parseAmount } from "@/lib/money";

export const GOAL_COLORS = [
  "#10b981",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#f59e0b",
  "#ef4444",
  "#14b8a6",
  "#64748b",
] as const;

const DEFAULT_COLOR: string = GOAL_COLORS[0];

/** Compte auquel un objectif peut être rattaché. */
export type GoalAccountOption = { id: number; name: string; archived: boolean; balance: number };

/** Objectif tel que reçu du serveur, avec le montant effectivement atteint. */
export type GoalView = {
  id: number;
  name: string;
  targetAmount: number;
  accountId: number | null;
  /** Montant saisi à la main (ignoré quand l'objectif suit un compte). */
  currentAmount: number;
  deadline: string | null;
  color: string;
  /** Montant actuel retenu : solde du compte lié, sinon `currentAmount`. */
  current: number;
};

/** « 125000 » (centimes) → « 1250,00 » pour pré-remplir un champ. */
function centsToInput(cents: number): string {
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
}

type Errors = Partial<Record<"name" | "target" | "current" | "deadline", string>>;

export type GoalDialogProps = {
  open: boolean;
  onClose: () => void;
  accounts: GoalAccountOption[];
  /** Objectif à modifier ; absent = création. */
  goal?: GoalView | null;
};

/**
 * Dialogue de création / modification / suppression d'un objectif. Le contenu garde son état tant
 * que le composant reste monté : le parent change la `key` à chaque ouverture.
 */
export function GoalDialog({ open, onClose, accounts, goal }: GoalDialogProps) {
  const router = useRouter();
  const formId = useId();
  const editing = !!goal;

  const selectable = useMemo(
    () => accounts.filter((a) => !a.archived || a.id === goal?.accountId),
    [accounts, goal?.accountId],
  );

  const [name, setName] = useState(goal?.name ?? "");
  const [target, setTarget] = useState(goal ? centsToInput(goal.targetAmount) : "");
  const [accountId, setAccountId] = useState(goal?.accountId ? String(goal.accountId) : "");
  // Un objectif lié reprend son montant actuel (solde du compte) si on le détache.
  const [current, setCurrent] = useState(goal ? centsToInput(Math.max(0, goal.current)) : "");
  const [deadline, setDeadline] = useState(goal?.deadline ?? "");
  const [color, setColor] = useState<string>(goal?.color ?? DEFAULT_COLOR);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // `autoFocus` est appelé avant showModal() : on place le focus une fois le dialogue ouvert.
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) nameRef.current?.focus();
  }, [open]);

  const linked = accountId !== "";
  const linkedAccount = accounts.find((a) => String(a.id) === accountId);
  const colors: readonly string[] = GOAL_COLORS.includes(color as (typeof GOAL_COLORS)[number])
    ? GOAL_COLORS
    : [...GOAL_COLORS, color];

  function validate() {
    const next: Errors = {};
    if (name.trim() === "") next.name = "Donnez un nom à l'objectif.";
    else if (name.trim().length > 200) next.name = "200 caractères au maximum.";

    const targetCents = parseAmount(target);
    if (target.trim() === "") next.target = "Saisissez le montant à atteindre.";
    else if (targetCents === null) next.target = "Montant illisible. Exemple : 5 000.";
    else if (targetCents <= 0) next.target = "Le montant doit être supérieur à 0.";
    else if (targetCents > 9_999_999_999) next.target = "Montant trop élevé.";

    let currentCents = 0;
    if (!linked && current.trim() !== "") {
      const parsed = parseAmount(current);
      if (parsed === null) next.current = "Montant illisible. Exemple : 1 200.";
      else if (parsed < 0) next.current = "Le montant ne peut pas être négatif.";
      else if (parsed > 9_999_999_999) next.current = "Montant trop élevé.";
      else currentCents = parsed;
    }
    if (deadline !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) next.deadline = "Choisissez une date valide.";

    setErrors(next);
    if (Object.keys(next).length > 0 || targetCents === null) return null;
    return { targetCents, currentCents };
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const valid = validate();
    if (!valid) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        targetAmount: valid.targetCents,
        accountId: linked ? Number(accountId) : null,
        deadline: deadline === "" ? null : deadline,
        color,
      };
      if (!linked) body.currentAmount = valid.currentCents;
      const res = await fetch(editing ? `/api/goals/${goal.id}` : "/api/goals", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        toast.error("Enregistrement impossible", { description: await errorMessage(res) });
        return;
      }
      toast.success(editing ? "Objectif modifié" : "Objectif créé");
      onClose();
      router.refresh();
    } catch {
      toast.error("Enregistrement impossible", { description: "Le serveur est injoignable." });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!goal) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/goals/${goal.id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Suppression impossible", { description: await errorMessage(res) });
        return;
      }
      toast.success("Objectif supprimé");
      onClose();
      router.refresh();
    } catch {
      toast.error("Suppression impossible", { description: "Le serveur est injoignable." });
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  const busy = saving || deleting;

  const footer = confirmDelete ? (
    <>
      <p className="mr-auto self-center text-[13px] text-muted">Supprimer définitivement cet objectif ?</p>
      <Button variant="secondary" onClick={() => setConfirmDelete(false)} disabled={busy}>
        Annuler
      </Button>
      <Button variant="danger" onClick={remove} loading={deleting}>
        Confirmer la suppression
      </Button>
    </>
  ) : (
    <>
      {editing && (
        <Button
          variant="ghost"
          className="text-danger! hover:text-danger! sm:mr-auto"
          onClick={() => setConfirmDelete(true)}
          disabled={busy}
        >
          Supprimer
        </Button>
      )}
      <Button variant="secondary" onClick={onClose} disabled={busy}>
        Annuler
      </Button>
      <Button type="submit" form={formId} loading={saving}>
        {editing ? "Enregistrer" : "Créer l'objectif"}
      </Button>
    </>
  );

  return (
    <Sheet open={open} onClose={onClose} title={editing ? "Modifier l'objectif" : "Nouvel objectif"} footer={footer}>
      <form id={formId} onSubmit={submit} noValidate className="space-y-4">
        <Input
          label="Nom"
          autoComplete="off"
          maxLength={200}
          placeholder="Ex. Voyage au Japon"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
          ref={nameRef}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Montant à atteindre"
            inputMode="decimal"
            autoComplete="off"
            placeholder="5 000"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            error={errors.target}
            hint={errors.target ? undefined : "En euros"}
          />
          <Input
            label="Échéance (facultatif)"
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            error={errors.deadline}
          />
        </div>

        <Select
          label="Compte lié (facultatif)"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          options={selectable.map((a) => ({
            value: a.id,
            label: a.archived ? `${a.name} (archivé)` : a.name,
          }))}
          placeholder="Aucun : je saisis le montant moi-même"
          hint={
            linkedAccount
              ? `Le montant actuel suit le solde du compte (${formatEUR(linkedAccount.balance)}).`
              : "Rattachez l'objectif à un compte pour suivre son solde automatiquement."
          }
        />

        {!linked && (
          <Input
            label="Montant actuel"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0,00"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            error={errors.current}
            hint={errors.current ? undefined : "Ce que vous avez déjà mis de côté, en euros"}
          />
        )}

        <ColorPicker value={color} onChange={setColor} colors={colors} />
      </form>
    </Sheet>
  );
}

function ColorPicker({
  value,
  onChange,
  colors,
}: {
  value: string;
  onChange: (c: string) => void;
  colors: readonly string[];
}) {
  const labelId = useId();
  return (
    <div className="space-y-1.5">
      <p id={labelId} className="text-[13px] font-medium text-fg">
        Couleur
      </p>
      <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap gap-2.5">
        {colors.map((c, i) => {
          const active = c === value;
          return (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`Couleur ${i + 1}`}
              onClick={() => onChange(c)}
              style={{ backgroundColor: c }}
              className={cn(
                "inline-flex size-8 items-center justify-center rounded-full text-white transition-shadow",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                active && "ring-2 ring-fg ring-offset-2 ring-offset-surface",
              )}
            >
              {active && <Check aria-hidden className="size-4" strokeWidth={3} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
