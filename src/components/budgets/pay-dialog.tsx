"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { centsToInput } from "@/lib/amount-input";
import { todayLocal } from "@/lib/dates";
import { parsePositiveAmount } from "@/lib/forecast-ui";
import { errorMessage } from "@/lib/http";
import { formatEUR } from "@/lib/money";
import { defaultAccountId } from "@/lib/quick-add";

export type PayAccount = { id: number; name: string; type: string; archived: boolean };

export type PayDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Mois `YYYY-MM` validé. */
  period: string;
  item: { id: number; label: string; amount: number; accountId: number; categoryName: string | null };
  /** Tous les comptes : seuls les non archivés sont proposés. */
  accounts: PayAccount[];
};

type Errors = Partial<Record<"amount" | "date" | "account", string>>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * « Valider » une récurrente du mois : montant (prérempli), date (aujourd'hui) et compte, puis
 * création de l'opération. Le parent change la `key` à chaque ouverture pour repartir à neuf.
 */
export function PayDialog({ open, onClose, period, item, accounts }: PayDialogProps) {
  const router = useRouter();
  const formId = useId();
  const openAccounts = accounts.filter((a) => !a.archived);
  const [amount, setAmount] = useState(centsToInput(item.amount));
  const [date, setDate] = useState(todayLocal);
  const [accountId, setAccountId] = useState(() => {
    const id = openAccounts.some((a) => a.id === item.accountId) ? item.accountId : defaultAccountId(accounts);
    return id != null ? String(id) : "";
  });
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  // Échap ou clic sur le fond pendant l'envoi : ignorés.
  const close = () => {
    if (!saving) onClose();
  };

  const amountRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) amountRef.current?.focus();
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: Errors = {};
    const parsed = parsePositiveAmount(amount);
    if (!parsed.ok) next.amount = parsed.error;
    if (!DATE.test(date)) next.date = "Choisissez une date valide.";
    if (accountId === "") next.account = "Choisissez un compte.";
    setErrors(next);
    if (!parsed.ok || Object.keys(next).length > 0) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/recurring/${item.id}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period, amount: parsed.cents, date, accountId: Number(accountId) }),
      });
      if (res.status === 201) {
        toast.success("Dépense validée", { description: `${item.label} : ${formatEUR(parsed.cents)}` });
        onClose();
        router.refresh();
        return;
      }
      toast.error("Validation impossible", { description: await errorMessage(res) });
      // Déjà validée ou passée ailleurs : la liste n'est plus à jour.
      if (res.status === 409) {
        onClose();
        router.refresh();
      }
    } catch {
      toast.error("Validation impossible", { description: "Le serveur est injoignable." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Valider la dépense"
      description={`${item.label}${item.categoryName ? ` · ${item.categoryName}` : ""} : une opération sera ajoutée à l'Activité.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            <X aria-hidden />
            Annuler
          </Button>
          <Button type="submit" form={formId} loading={saving}>
            <Check aria-hidden />
            Valider
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            ref={amountRef}
            label="Montant (€)"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0,00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            error={errors.amount}
            hint={errors.amount ? undefined : "Montant réellement prélevé"}
            className="num"
          />
          <Input
            label="Date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            error={errors.date}
          />
        </div>
        <Select
          label="Compte"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          error={errors.account}
          placeholder={accountId === "" ? "Choisir un compte" : undefined}
          options={openAccounts.map((a) => ({ value: a.id, label: a.name }))}
        />
      </form>
    </Sheet>
  );
}
