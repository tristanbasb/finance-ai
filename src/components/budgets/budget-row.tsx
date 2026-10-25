"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Pencil, Plus, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/components/ui/toast";
import { controlClasses } from "@/components/ui/field";
import { CategoryIcon } from "@/components/category-icon";
import { centsToInput } from "@/lib/amount-input";
import { parseBudgetInput } from "@/lib/budget-input";
import type { BudgetRowData } from "@/lib/budget-month";
import { budgetStatus } from "@/lib/finance";
import { formatPercent } from "@/lib/format";
import { errorMessage } from "@/lib/http";
import { formatEUR } from "@/lib/money";
import { cn } from "@/lib/cn";

/** Ligne d'une catégorie de dépense : dépensé, barre d'avancement et budget modifiable sur place. */
export function BudgetRow({ row }: { row: BudgetRowData }) {
  const router = useRouter();
  const uid = useId();
  const inputId = `${uid}-in`;
  const errorId = `${uid}-err`;
  // Valeur affichée avant que le serveur n'ait renvoyé la nouvelle (`undefined` : celle du serveur).
  const [optimistic, setOptimistic] = useState<{ value: number | null; base: number | null } | undefined>();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const finished = useRef(false);
  // Échap ou Entrée : le focus revient au bouton du budget une fois le champ refermé.
  const refocus = useRef(false);

  useEffect(() => {
    if (!editing && refocus.current) {
      refocus.current = false;
      buttonRef.current?.focus();
    }
  }, [editing]);

  // Valable tant que le serveur n'a pas renvoyé un budget différent de celui d'avant la modification.
  const budget = optimistic && optimistic.base === row.budget ? optimistic.value : row.budget;
  const status = budgetStatus(row.spent, budget);
  const remaining = budget === null ? 0 : budget - row.spent;

  function startEditing() {
    finished.current = false;
    setError(null);
    setEditing(true);
  }

  function cancel() {
    finished.current = true;
    setError(null);
    setEditing(false);
  }

  /**
   * Enregistre la saisie. Valeur invalide : Entrée garde le champ ouvert avec l'erreur ; une
   * perte de focus le referme sans rien changer et signale l'erreur par un toast (un champ
   * resté ouvert sans focus ne pourrait plus être annulé par Échap).
   */
  async function save(trigger: "submit" | "blur") {
    if (finished.current) return;
    const result = parseBudgetInput(inputRef.current?.value ?? "");
    if (!result.ok) {
      if (trigger === "submit") {
        setError(result.error);
        return;
      }
      cancel();
      toast.error("Budget non modifié", { description: `${row.name} : ${result.error}` });
      return;
    }
    if (trigger === "submit") refocus.current = true;
    finished.current = true;
    setEditing(false);
    setError(null);
    if (result.cents === budget) return;

    const previous = budget;
    setOptimistic({ value: result.cents, base: row.budget });
    try {
      const res = await fetch(`/api/categories/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthlyBudget: result.cents }),
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      toast.success(result.cents === null ? "Budget supprimé" : "Budget enregistré", { description: row.name });
      router.refresh();
    } catch (err) {
      setOptimistic({ value: previous, base: row.budget });
      toast.error("Budget non enregistré", {
        description: err instanceof Error && err.message ? err.message : "Le serveur est injoignable.",
      });
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void save("submit");
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      refocus.current = true;
      cancel();
    }
  }

  return (
    <li className="space-y-3 py-4 first:pt-0 last:pb-0">
      <div className="flex items-center gap-3">
        <CategoryIcon icon={row.icon} color={row.color} size="md" tinted />
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-fg">{row.name}</span>
        <span className="num shrink-0 text-[15px] font-semibold text-fg">{formatEUR(row.spent)}</span>
      </div>

      {status && (
        <Progress
          value={status.pct}
          level={status.level}
          label={`Budget ${row.name}`}
          valueText={`${formatPercent(status.pct)} du budget utilisé`}
        />
      )}

      <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[13px]">
        <span className="min-w-0">
          {status === null ? (
            <span className="text-muted">Pas de budget</span>
          ) : status.level === "over" ? (
            <Badge variant="danger">
              <CircleAlert aria-hidden />
              Dépassé de {formatEUR(-remaining)}
            </Badge>
          ) : status.level === "warn" ? (
            <Badge variant="warning">
              <TriangleAlert aria-hidden />
              Reste {formatEUR(remaining)}
            </Badge>
          ) : (
            <span className="text-muted">Reste {formatEUR(remaining)}</span>
          )}
          {status && <span className="num ml-2 text-subtle">{formatPercent(status.pct)}</span>}
        </span>

        {editing ? (
          <form onSubmit={onSubmit} noValidate className="flex flex-col items-end gap-1">
            <label htmlFor={inputId} className="sr-only">
              Budget mensuel de {row.name}, en euros
            </label>
            <div className="relative">
              <input
                id={inputId}
                ref={inputRef}
                autoFocus
                inputMode="decimal"
                autoComplete="off"
                defaultValue={budget === null ? "" : centsToInput(budget)}
                placeholder="Sans budget"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                onFocus={(e) => e.currentTarget.select()}
                onKeyDown={onKeyDown}
                onBlur={() => void save("blur")}
                className={cn(controlClasses, "num w-36 pr-8 text-right")}
              />
              <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted">
                €
              </span>
            </div>
            {error ? (
              <p id={errorId} role="alert" className="text-[12px] text-danger">
                {error}
              </p>
            ) : (
              <p className="text-[12px] text-subtle">Entrée pour valider, Échap pour annuler. Vide : sans budget.</p>
            )}
          </form>
        ) : (
          <button
            ref={buttonRef}
            type="button"
            onClick={startEditing}
            aria-label={`Modifier le budget de ${row.name}`}
            className="num -mr-2 inline-flex min-h-8 items-center gap-1.5 rounded-full px-2.5 font-medium text-fg transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-11 [&_svg]:size-3.5"
          >
            {budget === null ? (
              <>
                <Plus aria-hidden />
                <span className="text-brand">Définir un budget</span>
              </>
            ) : (
              <>
                <span>Budget {formatEUR(budget)}</span>
                <Pencil aria-hidden className="text-muted" />
              </>
            )}
          </button>
        )}
      </div>
    </li>
  );
}
