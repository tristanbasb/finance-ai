"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus, Trash2, X } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { centsToInput } from "@/lib/amount-input";
import { errorMessage } from "@/lib/http";
import { MAX_CENTS, parseAmount } from "@/lib/money";
import { defaultAccountId } from "@/lib/quick-add";
import { FRENCH_MONTHS, type RecurringFrequency } from "@/lib/settings-ui";
import type { AccountRow, CategoryRow } from "./types";

export type RecurringRow = {
  id: number;
  label: string;
  amount: number;
  categoryId: number | null;
  accountId: number;
  frequency: RecurringFrequency;
  anchorMonth: number | null;
  active: boolean;
};

const FREQUENCY_OPTIONS: { value: RecurringFrequency; label: string }[] = [
  { value: "monthly", label: "Tous les mois" },
  { value: "quarterly", label: "Tous les 3 mois" },
  { value: "yearly", label: "Chaque année" },
];

const MONTH_OPTIONS = FRENCH_MONTHS.map((m, i) => ({ value: i + 1, label: m.charAt(0).toUpperCase() + m.slice(1) }));

type Errors = Partial<Record<"label" | "amount" | "account", string>>;

export type RecurringDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Récurrente à modifier ; absente = création. */
  recurring?: RecurringRow | null;
  /** Catégories de dépenses. */
  categories: Pick<CategoryRow, "id" | "name">[];
  /** Tous les comptes : seuls les non archivés sont proposés (plus celui de la récurrente). */
  accounts: Pick<AccountRow, "id" | "name" | "type" | "archived">[];
};

/**
 * Dialogue de création / modification / suppression d'une dépense récurrente. Le parent change
 * la `key` à chaque ouverture pour repartir d'un état neuf.
 */
export function RecurringDialog({ open, onClose, recurring, categories, accounts }: RecurringDialogProps) {
  const router = useRouter();
  const formId = useId();
  const editing = !!recurring;

  const [label, setLabel] = useState(recurring?.label ?? "");
  const [amount, setAmount] = useState(recurring ? centsToInput(recurring.amount) : "");
  const [categoryId, setCategoryId] = useState<string>(recurring?.categoryId != null ? String(recurring.categoryId) : "");
  const [accountId, setAccountId] = useState<string>(() => {
    const id = recurring?.accountId ?? defaultAccountId(accounts);
    return id != null ? String(id) : "";
  });
  const [frequency, setFrequency] = useState<RecurringFrequency>(recurring?.frequency ?? "monthly");
  const [anchorMonth, setAnchorMonth] = useState<number>(recurring?.anchorMonth ?? new Date().getMonth() + 1);
  const [active, setActive] = useState(recurring?.active ?? true);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Comptes non archivés, plus celui de la récurrente s'il a été archivé depuis (pour ne pas le perdre).
  const accountOptions = accounts
    .filter((a) => !a.archived || a.id === recurring?.accountId)
    .map((a) => ({ value: a.id, label: a.archived ? `${a.name} (archivé)` : a.name }));

  const labelRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) labelRef.current?.focus();
  }, [open]);

  function validate(): number | null {
    const next: Errors = {};
    if (label.trim() === "") next.label = "Donnez un libellé à la dépense.";
    else if (label.trim().length > 80) next.label = "80 caractères au maximum.";

    let cents = 0;
    const parsed = amount.trim() === "" ? null : parseAmount(amount);
    if (amount.trim() === "") next.amount = "Indiquez le montant.";
    else if (parsed === null) next.amount = "Montant illisible. Exemple : 12,99.";
    else if (parsed <= 0) next.amount = "Le montant doit être supérieur à zéro.";
    else if (parsed > MAX_CENTS) next.amount = "Montant trop élevé.";
    else cents = parsed;

    if (accountId === "") next.account = "Choisissez un compte.";
    setErrors(next);
    return Object.keys(next).length > 0 ? null : cents;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const cents = validate();
    if (cents === null) return;
    setSaving(true);
    try {
      const res = await fetch(editing ? `/api/recurring/${recurring.id}` : "/api/recurring", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim(),
          amount: cents,
          categoryId: categoryId === "" ? null : Number(categoryId),
          accountId: Number(accountId),
          frequency,
          anchorMonth: frequency === "monthly" ? null : anchorMonth,
          active,
        }),
      });
      if (!res.ok) {
        toast.error("Enregistrement impossible", { description: await errorMessage(res) });
        return;
      }
      toast.success(editing ? "Dépense récurrente modifiée" : "Dépense récurrente ajoutée");
      onClose();
      router.refresh();
    } catch {
      toast.error("Enregistrement impossible", { description: "Le serveur est injoignable." });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!recurring) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/recurring/${recurring.id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Suppression impossible", { description: await errorMessage(res) });
        return;
      }
      toast.success("Dépense récurrente supprimée");
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
      <p className="mr-auto self-center text-[13px] text-muted">
        Supprimer cette dépense récurrente ? Les opérations déjà enregistrées sont conservées.
      </p>
      <Button variant="secondary" onClick={() => setConfirmDelete(false)} disabled={busy}>
        <X aria-hidden />
        Annuler
      </Button>
      <Button variant="danger" onClick={remove} loading={deleting}>
        <Trash2 aria-hidden />
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
          <Trash2 aria-hidden />
          Supprimer
        </Button>
      )}
      <Button variant="secondary" onClick={onClose} disabled={busy}>
        <X aria-hidden />
        Annuler
      </Button>
      <Button type="submit" form={formId} loading={saving}>
        {editing ? <Check aria-hidden /> : <Plus aria-hidden />}
        {editing ? "Enregistrer" : "Ajouter la dépense"}
      </Button>
    </>
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editing ? "Modifier la dépense récurrente" : "Nouvelle dépense récurrente"}
      footer={footer}
    >
      <form id={formId} onSubmit={submit} noValidate className="space-y-4">
        <Input
          label="Libellé"
          autoComplete="off"
          maxLength={80}
          placeholder="Ex. Loyer, Netflix, assurance auto"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          error={errors.label}
          ref={labelRef}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Montant"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0,00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            error={errors.amount}
            hint={errors.amount ? undefined : "En euros, montant prélevé à chaque échéance"}
          />
          <Select
            label="Catégorie"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            placeholder="Sans catégorie"
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
          />
        </div>

        <Select
          label="Compte"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          error={errors.account}
          placeholder={accountId === "" ? "Choisir un compte" : undefined}
          options={accountOptions}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select
            label="Fréquence"
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as RecurringFrequency)}
            options={FREQUENCY_OPTIONS}
          />
          {frequency !== "monthly" && (
            <Select
              label="Mois de référence"
              value={anchorMonth}
              onChange={(e) => setAnchorMonth(Number(e.target.value))}
              options={MONTH_OPTIONS}
              hint={frequency === "quarterly" ? "Premier mois de prélèvement" : "Mois du prélèvement"}
            />
          )}
        </div>

        <div className="rounded-xl border border-border p-3">
          <Switch
            label="Active"
            description="En pause, elle n'est plus comptée dans la prévision de fin de mois."
            checked={active}
            onChange={setActive}
          />
        </div>
      </form>
    </Sheet>
  );
}
