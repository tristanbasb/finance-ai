"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { controlClasses, describedBy, Field } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { parseAmount } from "@/lib/money";
import type { TransactionRow } from "@/lib/queries/transactions";

export type AccountOption = { id: number; name: string; archived: boolean };
export type CategoryOption = {
  id: number;
  name: string;
  kind: "expense" | "income";
  color: string;
  icon: string;
};

type Kind = "expense" | "income";

const textareaClasses = controlClasses.replace("h-10 ", "min-h-20 py-2 ");

/** « 1250 » (centimes) → « 12,50 » pour pré-remplir le champ montant. */
function centsToInput(cents: number): string {
  const abs = Math.abs(cents);
  return `${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    /* corps absent ou illisible */
  }
  return "Une erreur est survenue. Réessayez.";
}

type Errors = Partial<Record<"amount" | "date" | "label" | "account" | "note", string>>;

export type TransactionDialogProps = {
  open: boolean;
  onClose: () => void;
  accounts: AccountOption[];
  categories: CategoryOption[];
  /** Transaction à modifier ; absente = ajout. */
  transaction?: TransactionRow | null;
  /** Date du jour (YYYY-MM-DD) fournie par le serveur, pour éviter tout écart d'hydratation. */
  today: string;
  /** Compte présélectionné à l'ajout (filtre actif). */
  defaultAccountId?: number;
};

/**
 * Dialogue d'ajout / modification. Le contenu garde son état tant que le composant reste monté :
 * le parent change la `key` à chaque ouverture pour repartir d'un formulaire neuf.
 */
export function TransactionDialog({
  open,
  onClose,
  accounts,
  categories,
  transaction,
  today,
  defaultAccountId,
}: TransactionDialogProps) {
  const router = useRouter();
  const formId = useId();
  const editing = !!transaction;

  const selectableAccounts = useMemo(
    () => accounts.filter((a) => !a.archived || a.id === transaction?.accountId),
    [accounts, transaction?.accountId],
  );

  const [kind, setKind] = useState<Kind>(transaction && transaction.amount > 0 ? "income" : "expense");
  const [amount, setAmount] = useState(transaction ? centsToInput(transaction.amount) : "");
  const [date, setDate] = useState(transaction?.date ?? today);
  const [label, setLabel] = useState(transaction?.label ?? "");
  const [accountId, setAccountId] = useState(() => {
    if (transaction) return String(transaction.accountId);
    const preferred = selectableAccounts.find((a) => a.id === defaultAccountId) ?? selectableAccounts[0];
    return preferred ? String(preferred.id) : "";
  });
  const [categoryId, setCategoryId] = useState(transaction?.categoryId ? String(transaction.categoryId) : "");
  const [note, setNote] = useState(transaction?.note ?? "");
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // `autoFocus` de React appelle focus() avant showModal(), qui redonne alors le focus au 1er champ :
  // on place donc le focus sur le montant une fois le dialogue ouvert.
  const amountRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) amountRef.current?.focus();
  }, [open]);

  const categoryOptions = categories
    .filter((c) => c.kind === kind || String(c.id) === categoryId)
    .map((c) => ({ value: c.id, label: c.name }));

  function changeKind(next: Kind) {
    setKind(next);
    // Une catégorie de l'autre nature n'a plus de sens : on la retire.
    const current = categories.find((c) => String(c.id) === categoryId);
    if (current && current.kind !== next) setCategoryId("");
  }

  function validate(): { cents: number; accountId: number } | null {
    const next: Errors = {};
    const parsed = parseAmount(amount);
    if (amount.trim() === "") next.amount = "Saisissez un montant.";
    else if (parsed === null) next.amount = "Montant illisible. Exemple : 12,50.";
    else if (parsed === 0) next.amount = "Le montant doit être supérieur à 0.";
    else if (Math.abs(parsed) > 9_999_999_999) next.amount = "Montant trop élevé.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) next.date = "Choisissez une date valide.";
    if (label.trim() === "") next.label = "Saisissez un libellé.";
    else if (label.trim().length > 200) next.label = "200 caractères au maximum.";
    if (accountId === "") next.account = "Choisissez un compte.";
    if (note.length > 1000) next.note = "1 000 caractères au maximum.";
    setErrors(next);
    if (Object.keys(next).length > 0 || parsed === null) return null;
    const abs = Math.abs(parsed);
    return { cents: kind === "expense" ? -abs : abs, accountId: Number(accountId) };
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const valid = validate();
    if (!valid) return;
    setSaving(true);
    try {
      const res = await fetch(editing ? `/api/transactions/${transaction.id}` : "/api/transactions", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: valid.accountId,
          categoryId: categoryId === "" ? null : Number(categoryId),
          date,
          amount: valid.cents,
          label: label.trim(),
          note: note.trim() === "" ? null : note.trim(),
        }),
      });
      if (!res.ok) {
        toast.error("Enregistrement impossible", { description: await errorMessage(res) });
        return;
      }
      toast.success(editing ? "Transaction modifiée" : "Transaction ajoutée");
      onClose();
      router.refresh();
    } catch {
      toast.error("Enregistrement impossible", { description: "Le serveur est injoignable." });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!transaction) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/transactions/${transaction.id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Suppression impossible", { description: await errorMessage(res) });
        return;
      }
      toast.success("Transaction supprimée");
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
      <p className="mr-auto self-center text-[13px] text-muted">Supprimer définitivement cette transaction ?</p>
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
        {editing ? "Enregistrer" : "Ajouter"}
      </Button>
    </>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? "Modifier la transaction" : "Nouvelle transaction"}
      footer={footer}
    >
      <form id={formId} onSubmit={submit} noValidate className="space-y-4">
        <KindToggle value={kind} onChange={changeKind} />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Montant"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0,00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            error={errors.amount}
            hint={errors.amount ? undefined : "En euros, sans signe"}
            ref={amountRef}
          />
          <Input
            label="Date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            error={errors.date}
          />
        </div>

        <Input
          label="Libellé"
          autoComplete="off"
          maxLength={200}
          placeholder={kind === "expense" ? "Ex. Courses au marché" : "Ex. Salaire d'octobre"}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          error={errors.label}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select
            label="Compte"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            options={selectableAccounts.map((a) => ({
              value: a.id,
              label: a.archived ? `${a.name} (archivé)` : a.name,
            }))}
            placeholder={selectableAccounts.length === 0 ? "Aucun compte" : undefined}
            error={errors.account}
          />
          <Select
            label="Catégorie"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            options={categoryOptions}
            placeholder="Sans catégorie"
          />
        </div>

        <NoteField value={note} onChange={setNote} error={errors.note} />
      </form>
    </Dialog>
  );
}

function KindToggle({ value, onChange }: { value: Kind; onChange: (k: Kind) => void }) {
  const items: { kind: Kind; label: string }[] = [
    { kind: "expense", label: "Dépense" },
    { kind: "income", label: "Revenu" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Type de transaction"
      className="grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1"
    >
      {items.map((item) => {
        const active = item.kind === value;
        return (
          <button
            key={item.kind}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(item.kind)}
            className={cn(
              "h-8 rounded-md text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
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

function NoteField({
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
