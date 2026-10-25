"use client";

import { useEffect, useRef, type FormEvent } from "react";
import { Info } from "lucide-react";
import {
  TransactionFields,
  type AccountOption,
  type CategoryOption,
} from "@/components/transactions/transaction-fields";
import type { TransactionFormErrors, TransactionFormValues } from "@/lib/quick-add";

export type ManualFormProps = {
  id: string;
  values: TransactionFormValues;
  onChange: (next: TransactionFormValues) => void;
  errors: TransactionFormErrors;
  accounts: AccountOption[];
  categories: CategoryOption[];
  onSubmit: () => void;
  /** Message affiché au-dessus du formulaire (ex. montant introuvable dans la phrase). */
  notice?: string | null;
  /** Vrai quand la feuille est ouverte : le montant reçoit alors le focus. */
  active: boolean;
};

/** Mode formulaire de la saisie rapide : les champs partagés avec le dialogue de modification. */
export function ManualForm({
  id,
  values,
  onChange,
  errors,
  accounts,
  categories,
  onSubmit,
  notice,
  active,
}: ManualFormProps) {
  const amountRef = useRef<HTMLInputElement>(null);

  // Après showModal() (effet du parent, exécuté après celui-ci) : focus au montant.
  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => amountRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [active]);

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit();
  }

  return (
    <form id={id} onSubmit={submit} noValidate className="space-y-4">
      {notice && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-xl bg-warning-soft px-3.5 py-2.5 text-[13px] text-fg"
        >
          <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          {notice}
        </p>
      )}
      <TransactionFields
        values={values}
        onChange={onChange}
        errors={errors}
        accounts={accounts}
        categories={categories}
        amountRef={amountRef}
      />
    </form>
  );
}
