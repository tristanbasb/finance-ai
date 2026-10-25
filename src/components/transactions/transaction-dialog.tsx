"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/http";
import {
  proposalToFormValues,
  validateTransactionForm,
  type TransactionFormErrors,
  type TransactionFormValues,
} from "@/lib/quick-add";
import type { TransactionRow } from "@/lib/queries/transactions";
import { TransactionFields, type AccountOption, type CategoryOption } from "./transaction-fields";

export type { AccountOption, CategoryOption } from "./transaction-fields";

export type TransactionDialogProps = {
  open: boolean;
  onClose: () => void;
  accounts: AccountOption[];
  categories: CategoryOption[];
  /** Opération à modifier (l'ajout passe par la saisie rapide globale). */
  transaction: TransactionRow;
  /** Date du jour (YYYY-MM-DD) fournie par le serveur, pour éviter tout écart d'hydratation. */
  today: string;
};

/**
 * Feuille de modification d'une opération. Le contenu garde son état tant que le composant reste monté :
 * le parent change la `key` à chaque ouverture pour repartir d'un formulaire neuf.
 */
export function TransactionDialog({
  open,
  onClose,
  accounts,
  categories,
  transaction,
  today,
}: TransactionDialogProps) {
  const router = useRouter();
  const formId = useId();

  const selectableAccounts = useMemo(
    () => accounts.filter((a) => !a.archived || a.id === transaction.accountId),
    [accounts, transaction.accountId],
  );

  const [values, setValues] = useState<TransactionFormValues>(() => ({
    ...proposalToFormValues(
      {
        amountCents: transaction.amount,
        kind: transaction.amount > 0 ? "income" : "expense",
        categoryId: transaction.categoryId,
        label: transaction.label,
        date: transaction.date,
        accountId: transaction.accountId,
      },
      { today, accountId: null },
    ),
    note: transaction.note ?? "",
  }));
  const [errors, setErrors] = useState<TransactionFormErrors>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Au montage de la feuille, `autoFocus` serait annulé par `showModal()`, qui redonne le focus au
  // 1er champ : on place donc le focus sur le montant une fois la feuille ouverte, mais seulement
  // au pointeur fin (pas de clavier virtuel qui surgit à chaque ouverture sur téléphone).
  const amountRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open && window.matchMedia?.("(pointer: fine)").matches) amountRef.current?.focus();
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const result = validateTransactionForm(values);
    setErrors(result.ok ? {} : result.errors);
    if (!result.ok) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/transactions/${transaction.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result.body),
      });
      if (!res.ok) {
        toast.error("Enregistrement impossible", {
          description: await errorMessage(res),
        });
        return;
      }
      toast.success("Opération modifiée");
      onClose();
      router.refresh();
    } catch {
      toast.error("Enregistrement impossible", {
        description: "Le serveur est injoignable.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/transactions/${transaction.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        toast.error("Suppression impossible", {
          description: await errorMessage(res),
        });
        return;
      }
      toast.success("Opération supprimée");
      onClose();
      router.refresh();
    } catch {
      toast.error("Suppression impossible", {
        description: "Le serveur est injoignable.",
      });
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  const busy = saving || deleting;

  const footer = confirmDelete ? (
    <>
      <p className="mr-auto self-center text-[13px] text-muted max-md:order-last max-md:mr-0 max-md:text-center">Supprimer définitivement cette opération ?</p>
      <Button variant="secondary" onClick={() => setConfirmDelete(false)} disabled={busy}>
        Annuler
      </Button>
      <Button variant="danger" onClick={remove} loading={deleting}>
        Confirmer la suppression
      </Button>
    </>
  ) : (
    <>
      <Button
        variant="ghost"
        className="text-danger! hover:text-danger! md:mr-auto"
        onClick={() => setConfirmDelete(true)}
        disabled={busy}
      >
        Supprimer
      </Button>
      <Button variant="secondary" onClick={onClose} disabled={busy}>
        Annuler
      </Button>
      <Button type="submit" form={formId} loading={saving}>
        Enregistrer
      </Button>
    </>
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Modifier l'opération"
      footer={footer}
    >
      <form id={formId} onSubmit={submit} noValidate>
        <TransactionFields
          values={values}
          onChange={setValues}
          errors={errors}
          accounts={selectableAccounts}
          categories={categories}
          amountRef={amountRef}
        />
      </form>
    </Sheet>
  );
}
