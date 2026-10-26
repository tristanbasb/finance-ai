"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { centsToInput } from "@/lib/amount-input";
import { errorMessage } from "@/lib/http";
import { MAX_CENTS, parseAmount } from "@/lib/money";
import { ACCOUNT_COLORS, ColorPicker } from "./color-picker";
import { ACCOUNT_TYPE_LABELS, type AccountRow, type AccountType } from "./types";

const TYPE_OPTIONS = (Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]).map((value) => ({
  value,
  label: ACCOUNT_TYPE_LABELS[value],
}));

type Errors = Partial<Record<"name" | "balance", string>>;

export type AccountDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Compte à modifier ; absent = création. */
  account?: AccountRow | null;
};

/**
 * Dialogue de création / modification / suppression d'un compte. Le contenu garde son état tant
 * que le composant reste monté : le parent change la `key` à chaque ouverture.
 */
export function AccountDialog({ open, onClose, account }: AccountDialogProps) {
  const router = useRouter();
  const formId = useId();
  const editing = !!account;

  const [name, setName] = useState(account?.name ?? "");
  const [type, setType] = useState<AccountType>(account?.type ?? "checking");
  const [balance, setBalance] = useState(account ? centsToInput(account.initialBalance) : "");
  const [color, setColor] = useState<string>(account?.color ?? ACCOUNT_COLORS[0]);
  const [archived, setArchived] = useState(account?.archived ?? false);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Suppression refusée (409) : on propose d'archiver à la place.
  const [blocked, setBlocked] = useState(false);
  const [archiving, setArchiving] = useState(false);

  // `autoFocus` est appelé avant showModal() : on place le focus une fois le dialogue ouvert.
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) nameRef.current?.focus();
  }, [open]);

  function validate(): number | null {
    const next: Errors = {};
    if (name.trim() === "") next.name = "Donnez un nom au compte.";
    else if (name.trim().length > 200) next.name = "200 caractères au maximum.";

    let cents = 0;
    if (balance.trim() !== "") {
      const parsed = parseAmount(balance);
      if (parsed === null) next.balance = "Montant illisible. Exemple : 1 250,00 ou -300.";
      else if (Math.abs(parsed) > MAX_CENTS) next.balance = "Montant trop élevé.";
      else cents = parsed;
    }
    setErrors(next);
    return Object.keys(next).length > 0 ? null : cents;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const cents = validate();
    if (cents === null) return;
    setSaving(true);
    try {
      const res = await fetch(editing ? `/api/accounts/${account.id}` : "/api/accounts", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), type, initialBalance: cents, color, archived }),
      });
      if (!res.ok) {
        toast.error("Enregistrement impossible", { description: await errorMessage(res) });
        return;
      }
      toast.success(editing ? "Compte modifié" : "Compte créé");
      onClose();
      router.refresh();
    } catch {
      toast.error("Enregistrement impossible", { description: "Le serveur est injoignable." });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!account) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/accounts/${account.id}`, { method: "DELETE" });
      if (res.status === 409) {
        toast.warning("Suppression impossible", { description: await errorMessage(res) });
        setBlocked(true);
        return;
      }
      if (!res.ok) {
        toast.error("Suppression impossible", { description: await errorMessage(res) });
        return;
      }
      toast.success("Compte supprimé");
      onClose();
      router.refresh();
    } catch {
      toast.error("Suppression impossible", { description: "Le serveur est injoignable." });
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  async function archiveInstead() {
    if (!account) return;
    setArchiving(true);
    try {
      const res = await fetch(`/api/accounts/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });
      if (!res.ok) {
        toast.error("Archivage impossible", { description: await errorMessage(res) });
        return;
      }
      toast.success("Compte archivé");
      onClose();
      router.refresh();
    } catch {
      toast.error("Archivage impossible", { description: "Le serveur est injoignable." });
    } finally {
      setArchiving(false);
    }
  }

  const busy = saving || deleting || archiving;

  const footer = blocked ? (
    <>
      <p className="mr-auto self-center text-[13px] text-muted">
        Ce compte contient des données : archivez-le pour le masquer.
      </p>
      <Button variant="secondary" onClick={() => setBlocked(false)} disabled={busy}>
        Retour
      </Button>
      <Button onClick={archiveInstead} loading={archiving}>
        Archiver le compte
      </Button>
    </>
  ) : confirmDelete ? (
    <>
      <p className="mr-auto self-center text-[13px] text-muted">Supprimer définitivement ce compte ?</p>
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
        {editing ? "Enregistrer" : "Créer le compte"}
      </Button>
    </>
  );

  return (
    <Sheet open={open} onClose={onClose} title={editing ? "Modifier le compte" : "Nouveau compte"} footer={footer}>
      <form id={formId} onSubmit={submit} noValidate className="space-y-4">
        <Input
          label="Nom"
          autoComplete="off"
          maxLength={200}
          placeholder="Ex. Livret A"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
          ref={nameRef}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select
            label="Type"
            value={type}
            onChange={(e) => setType(e.target.value as AccountType)}
            options={TYPE_OPTIONS}
          />
          <Input
            label="Solde initial"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0,00"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            error={errors.balance}
            hint={errors.balance ? undefined : "En euros, peut être négatif"}
          />
        </div>

        <ColorPicker value={color} onChange={setColor} palette={ACCOUNT_COLORS} />

        {editing && (
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 cursor-pointer accent-accent"
            />
            <span className="space-y-0.5">
              <span className="block text-[13px] font-medium text-fg">Archiver ce compte</span>
              <span className="block text-[12px] text-muted">
                Il n&apos;apparaît plus dans les listes de saisie. Son historique est conservé.
              </span>
            </span>
          </label>
        )}
      </form>
    </Sheet>
  );
}
