"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/http";
import { parseQuantity, parseUnitPrice } from "@/lib/money";
import { ASSET_TYPE_LABELS, type AssetType, type HoldingRow } from "./types";

/** Compte pouvant recevoir une position. */
export type HoldingAccountOption = { id: number; name: string; archived: boolean };

const ASSET_TYPES: AssetType[] = ["stock", "etf", "crypto", "manual"];

/** Nombre → champ de saisie à la française, sans zéros inutiles (jusqu'à 8 décimales). */
function numberToInput(value: number): string {
  return value
    .toFixed(8)
    .replace(/\.?0+$/, "")
    .replace(".", ",");
}

type Errors = Partial<Record<"account" | "symbol" | "name" | "quantity" | "avgPrice" | "manualPrice" | "currency", string>>;

export type HoldingDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Comptes d'investissement, de crypto ou « autre ». */
  accounts: HoldingAccountOption[];
  /** Position à modifier ; absente = ajout. */
  holding?: HoldingRow | null;
};

/**
 * Dialogue d'ajout / modification / suppression d'une position. Le contenu garde son état tant que
 * le composant reste monté : le parent change la `key` à chaque ouverture.
 */
export function HoldingDialog({ open, onClose, accounts, holding }: HoldingDialogProps) {
  const router = useRouter();
  const formId = useId();
  const editing = !!holding;

  const selectable = useMemo(
    () => accounts.filter((a) => !a.archived || a.id === holding?.accountId),
    [accounts, holding?.accountId],
  );

  const [accountId, setAccountId] = useState(() => {
    if (holding) return String(holding.accountId);
    return selectable[0] ? String(selectable[0].id) : "";
  });
  const [assetType, setAssetType] = useState<AssetType>(holding?.assetType ?? "etf");
  const [symbol, setSymbol] = useState(holding?.symbol ?? "");
  const [name, setName] = useState(holding?.name ?? "");
  const [quantity, setQuantity] = useState(holding ? numberToInput(holding.quantity) : "");
  const [avgPrice, setAvgPrice] = useState(holding ? numberToInput(holding.avgPrice / 100) : "");
  const [manualPrice, setManualPrice] = useState(
    holding?.manualPrice != null ? numberToInput(holding.manualPrice / 100) : "",
  );
  const [currency, setCurrency] = useState(holding?.currency ?? "EUR");
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // `autoFocus` est appelé avant showModal() : on place le focus une fois le dialogue ouvert.
  const symbolRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    (selectable.length > 0 ? symbolRef.current : null)?.focus();
  }, [open, selectable.length]);

  const isManual = assetType === "manual";
  const noAccount = selectable.length === 0;

  function validate() {
    const next: Errors = {};
    if (accountId === "") next.account = "Choisissez un compte.";

    const sym = symbol.trim();
    if (sym === "") next.symbol = "Saisissez un symbole.";
    else if (sym.length > 30) next.symbol = "30 caractères au maximum.";

    if (name.trim() === "") next.name = "Saisissez un nom.";
    else if (name.trim().length > 200) next.name = "200 caractères au maximum.";

    const qty = parseQuantity(quantity);
    if (quantity.trim() === "") next.quantity = "Saisissez une quantité.";
    else if (qty === null) next.quantity = "Quantité illisible. Exemple : 0,0523.";
    else if (qty <= 0) next.quantity = "La quantité doit être supérieure à 0.";
    else if (qty > 1e12) next.quantity = "Quantité trop élevée.";

    const avg = parseUnitPrice(avgPrice);
    if (avgPrice.trim() === "") next.avgPrice = "Saisissez le prix de revient unitaire.";
    else if (avg === null) next.avgPrice = "Prix illisible. Exemple : 82,35.";
    else if (avg > 1e13) next.avgPrice = "Prix trop élevé.";

    let manual: number | null = null;
    if (isManual && manualPrice.trim() !== "") {
      manual = parseUnitPrice(manualPrice);
      if (manual === null) next.manualPrice = "Prix illisible. Exemple : 250 000.";
      else if (manual > 1e13) next.manualPrice = "Prix trop élevé.";
    }

    if (currency.trim() === "") next.currency = "Saisissez une devise.";
    else if (currency.trim().length > 10) next.currency = "10 caractères au maximum.";

    setErrors(next);
    if (Object.keys(next).length > 0 || qty === null || avg === null) return null;
    return { qty, avg, manual };
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const valid = validate();
    if (!valid) return;
    setSaving(true);
    try {
      const res = await fetch(editing ? `/api/holdings/${holding.id}` : "/api/holdings", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: Number(accountId),
          symbol: symbol.trim(),
          name: name.trim(),
          assetType,
          quantity: valid.qty,
          avgPrice: valid.avg,
          manualPrice: isManual ? valid.manual : null,
          currency: currency.trim().toUpperCase(),
        }),
      });
      if (!res.ok) {
        toast.error("Enregistrement impossible", { description: await errorMessage(res) });
        return;
      }
      toast.success(editing ? "Position modifiée" : "Position ajoutée");
      onClose();
      router.refresh();
    } catch {
      toast.error("Enregistrement impossible", { description: "Le serveur est injoignable." });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!holding) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/holdings/${holding.id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Suppression impossible", { description: await errorMessage(res) });
        return;
      }
      toast.success("Position supprimée");
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
      <p className="mr-auto self-center text-[13px] text-muted">Supprimer définitivement cette position ?</p>
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
      <Button type="submit" form={formId} loading={saving} disabled={noAccount}>
        {editing ? "Enregistrer" : "Ajouter"}
      </Button>
    </>
  );

  return (
    <Sheet open={open} onClose={onClose} title={editing ? "Modifier la position" : "Nouvelle position"} footer={footer}>
      <form id={formId} onSubmit={submit} noValidate className="space-y-4">
        {noAccount ? (
          <div className="flex items-start gap-2.5 rounded-lg bg-accent-soft p-3 text-[13px] text-fg">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
            <p>
              Aucun compte d&apos;investissement n&apos;existe encore.{" "}
              <Link href="/settings#comptes" className="font-medium text-accent underline underline-offset-2">
                Créez un compte de type Investissement ou Crypto dans les réglages
              </Link>
              , puis revenez ajouter votre position.
            </p>
          </div>
        ) : (
          <Select
            label="Compte"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            options={selectable.map((a) => ({
              value: a.id,
              label: a.archived ? `${a.name} (archivé)` : a.name,
            }))}
            error={errors.account}
          />
        )}

        <AssetTypeToggle value={assetType} onChange={setAssetType} />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Symbole"
            autoComplete="off"
            autoCapitalize="characters"
            maxLength={30}
            placeholder={isManual ? "APPART-PARIS" : "CW8.PA"}
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            error={errors.symbol}
            hint={
              errors.symbol
                ? undefined
                : isManual
                  ? "Identifiant libre, sans cours automatique"
                  : "Ex. CW8.PA, AAPL, BTC"
            }
            ref={symbolRef}
          />
          <Input
            label="Nom"
            autoComplete="off"
            maxLength={200}
            placeholder={isManual ? "Appartement" : "Amundi MSCI World"}
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={errors.name}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Quantité"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0,0523"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            error={errors.quantity}
            hint={errors.quantity ? undefined : "Décimales acceptées (crypto)"}
          />
          <Input
            label="Prix de revient unitaire (PRU)"
            inputMode="decimal"
            autoComplete="off"
            placeholder="82,35"
            value={avgPrice}
            onChange={(e) => setAvgPrice(e.target.value)}
            error={errors.avgPrice}
            hint={errors.avgPrice ? undefined : "Prix moyen d'achat par unité, en euros"}
          />
        </div>

        {isManual && (
          <Input
            label="Prix actuel (facultatif)"
            inputMode="decimal"
            autoComplete="off"
            placeholder="250 000"
            value={manualPrice}
            onChange={(e) => setManualPrice(e.target.value)}
            error={errors.manualPrice}
            hint={errors.manualPrice ? undefined : "Valeur estimée par unité, en euros. Vide : le PRU est utilisé."}
          />
        )}

        <Input
          label="Devise"
          autoComplete="off"
          maxLength={10}
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          error={errors.currency}
          hint={errors.currency ? undefined : "Informative : les prix sont en euros"}
          wrapperClassName="sm:max-w-[14rem]"
        />
      </form>
    </Sheet>
  );
}

function AssetTypeToggle({ value, onChange }: { value: AssetType; onChange: (t: AssetType) => void }) {
  const labelId = useId();
  return (
    <div className="space-y-1.5">
      <p id={labelId} className="text-[13px] font-medium text-fg">
        Type d&apos;actif
      </p>
      <div role="radiogroup" aria-labelledby={labelId} className="grid grid-cols-4 gap-1 rounded-lg bg-surface-2 p-1">
        {ASSET_TYPES.map((t) => {
          const active = t === value;
          return (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(t)}
              className={cn(
                "h-8 rounded-md text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                active ? "bg-surface text-fg shadow-[0_0_0_1px_var(--border)]" : "text-muted hover:text-fg",
              )}
            >
              {ASSET_TYPE_LABELS[t]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
