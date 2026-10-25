"use client";

import { useId, useRef, type KeyboardEvent, type Ref } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { controlClasses, describedBy, Field } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import {
  MAX_LABEL_LENGTH,
  withKind,
  type TransactionFormErrors,
  type TransactionFormValues,
  type TransactionKind,
} from "@/lib/quick-add";

export type AccountOption = {
  id: number;
  name: string;
  archived: boolean;
  type?: string;
};
export type CategoryOption = {
  id: number;
  name: string;
  kind: TransactionKind;
  color: string;
  icon: string;
};

const textareaClasses = controlClasses.replace("h-10 ", "min-h-20 py-2 ");

const KINDS: { kind: TransactionKind; label: string }[] = [
  { kind: "expense", label: "Dépense" },
  { kind: "income", label: "Revenu" },
];

/**
 * Choix Dépense / Revenu : groupe de boutons radio (une seule tabulation, flèches pour changer).
 */
export function KindToggle({
  value,
  onChange,
  className,
}: {
  value: TransactionKind;
  onChange: (k: TransactionKind) => void;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const index = KINDS.findIndex((k) => k.kind === value);
    const next = (index + step + KINDS.length) % KINDS.length;
    onChange(KINDS[next].kind);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Type d'opération"
      onKeyDown={onKeyDown}
      className={cn("grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1", className)}
    >
      {KINDS.map((item, i) => {
        const active = item.kind === value;
        return (
          <button
            key={item.kind}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.kind)}
            className={cn(
              "h-8 rounded-md text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring pointer-coarse:h-11",
              active ? "bg-surface text-fg shadow-[0_0_0_1px_var(--border)]" : "text-muted hover:text-fg",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export function NoteField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  const id = useId();
  return (
    <Field id={id} label="Note (facultatif)" error={error}>
      <textarea
        id={id}
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, undefined, error)}
        className={textareaClasses}
      />
    </Field>
  );
}

export type TransactionFieldsProps = {
  values: TransactionFormValues;
  onChange: (next: TransactionFormValues) => void;
  errors: TransactionFormErrors;
  /** Comptes proposés (déjà filtrés par l'appelant). */
  accounts: AccountOption[];
  categories: CategoryOption[];
  amountRef?: Ref<HTMLInputElement>;
};

/**
 * Champs d'une opération (sens, montant, date, libellé, compte, catégorie, note), partagés
 * par le dialogue de modification et le mode formulaire de la saisie rapide.
 */
export function TransactionFields({
  values,
  onChange,
  errors,
  accounts,
  categories,
  amountRef,
}: TransactionFieldsProps) {
  const set = <K extends keyof TransactionFormValues>(key: K, value: TransactionFormValues[K]) =>
    onChange({ ...values, [key]: value });

  const categoryOptions = categories
    .filter((c) => c.kind === values.kind || String(c.id) === values.categoryId)
    .map((c) => ({ value: c.id, label: c.name }));

  return (
    <div className="space-y-4">
      <KindToggle value={values.kind} onChange={(k) => onChange(withKind(values, k, categories))} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Montant"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0,00"
          value={values.amount}
          onChange={(e) => set("amount", e.target.value)}
          error={errors.amount}
          hint={errors.amount ? undefined : "En euros, sans signe"}
          ref={amountRef}
        />
        <Input
          label="Date"
          type="date"
          value={values.date}
          onChange={(e) => set("date", e.target.value)}
          error={errors.date}
        />
      </div>

      <Input
        label="Libellé"
        autoComplete="off"
        maxLength={MAX_LABEL_LENGTH}
        placeholder={values.kind === "expense" ? "Ex. Courses au marché" : "Ex. Salaire d'octobre"}
        value={values.label}
        onChange={(e) => set("label", e.target.value)}
        error={errors.label}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select
          label="Compte"
          value={values.accountId}
          onChange={(e) => set("accountId", e.target.value)}
          options={accounts.map((a) => ({
            value: a.id,
            label: a.archived ? `${a.name} (archivé)` : a.name,
          }))}
          placeholder={accounts.length === 0 ? "Aucun compte" : undefined}
          error={errors.account}
        />
        <Select
          label="Catégorie"
          value={values.categoryId}
          onChange={(e) => set("categoryId", e.target.value)}
          options={categoryOptions}
          placeholder="Sans catégorie"
        />
      </div>

      <NoteField value={values.note} onChange={(v) => set("note", v)} error={errors.note} />
    </div>
  );
}
