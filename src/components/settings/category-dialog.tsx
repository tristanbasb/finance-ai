"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { CATEGORY_ICON_NAMES, CategoryIcon, categoryIconComponent } from "@/components/category-icon";
import { centsToInput } from "@/lib/amount-input";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/http";
import { parseAmount } from "@/lib/money";
import { CATEGORY_COLORS, ColorPicker } from "./color-picker";
import type { CategoryKind, CategoryRow } from "./types";

const KIND_OPTIONS: { value: CategoryKind; label: string }[] = [
  { value: "expense", label: "Dépense" },
  { value: "income", label: "Revenu" },
];

const MAX_BUDGET_CENTS = 9_999_999_999;

type Errors = Partial<Record<"name" | "budget", string>>;

export type CategoryDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Catégorie à modifier ; absente = création. */
  category?: CategoryRow | null;
  /** Type présélectionné à la création (selon le groupe d'où l'on part). */
  defaultKind?: CategoryKind;
};

/**
 * Dialogue de création / modification / suppression d'une catégorie. Le contenu garde son état tant
 * que le composant reste monté : le parent change la `key` à chaque ouverture.
 */
export function CategoryDialog({ open, onClose, category, defaultKind = "expense" }: CategoryDialogProps) {
  const router = useRouter();
  const formId = useId();
  const editing = !!category;

  const [name, setName] = useState(category?.name ?? "");
  const [kind, setKind] = useState<CategoryKind>(category?.kind ?? defaultKind);
  const [color, setColor] = useState<string>(category?.color ?? CATEGORY_COLORS[0]);
  const [icon, setIcon] = useState<string>(category?.icon ?? "tag");
  const [budget, setBudget] = useState(
    category?.monthlyBudget != null ? centsToInput(category.monthlyBudget) : "",
  );
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // `autoFocus` est appelé avant showModal() : on place le focus une fois le dialogue ouvert.
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) nameRef.current?.focus();
  }, [open]);

  const isExpense = kind === "expense";

  function validate(): { budgetCents: number | null } | null {
    const next: Errors = {};
    if (name.trim() === "") next.name = "Donnez un nom à la catégorie.";
    else if (name.trim().length > 200) next.name = "200 caractères au maximum.";

    let budgetCents: number | null = null;
    if (isExpense && budget.trim() !== "") {
      const parsed = parseAmount(budget);
      if (parsed === null) next.budget = "Montant illisible. Exemple : 400.";
      else if (parsed < 0) next.budget = "Le budget ne peut pas être négatif.";
      else if (parsed > MAX_BUDGET_CENTS) next.budget = "Montant trop élevé.";
      else budgetCents = parsed;
    }
    setErrors(next);
    return Object.keys(next).length > 0 ? null : { budgetCents };
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const valid = validate();
    if (!valid) return;
    setSaving(true);
    try {
      const res = await fetch(editing ? `/api/categories/${category.id}` : "/api/categories", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          kind,
          color,
          icon,
          // Un budget n'a de sens que pour une dépense : un revenu l'efface.
          monthlyBudget: isExpense ? valid.budgetCents : null,
        }),
      });
      if (!res.ok) {
        toast.error("Enregistrement impossible", { description: await errorMessage(res) });
        return;
      }
      toast.success(editing ? "Catégorie modifiée" : "Catégorie créée");
      onClose();
      router.refresh();
    } catch {
      toast.error("Enregistrement impossible", { description: "Le serveur est injoignable." });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!category) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/categories/${category.id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Suppression impossible", { description: await errorMessage(res) });
        return;
      }
      toast.success("Catégorie supprimée");
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
        Les transactions de cette catégorie seront conservées, sans catégorie.
      </p>
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
        {editing ? "Enregistrer" : "Créer la catégorie"}
      </Button>
    </>
  );

  return (
    <Sheet open={open} onClose={onClose} title={editing ? "Modifier la catégorie" : "Nouvelle catégorie"} footer={footer}>
      <form id={formId} onSubmit={submit} noValidate className="space-y-4">
        <div className="flex items-end gap-3">
          <CategoryIcon icon={icon} color={color} className="mb-0.5" />
          <Input
            wrapperClassName="min-w-0 flex-1"
            label="Nom"
            autoComplete="off"
            maxLength={200}
            placeholder="Ex. Courses"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={errors.name}
            ref={nameRef}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select
            label="Type"
            value={kind}
            onChange={(e) => setKind(e.target.value as CategoryKind)}
            options={KIND_OPTIONS}
          />
          {isExpense && (
            <Input
              label="Budget mensuel (facultatif)"
              inputMode="decimal"
              autoComplete="off"
              placeholder="Aucun"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              error={errors.budget}
              hint={errors.budget ? undefined : "En euros, par mois"}
            />
          )}
        </div>

        <ColorPicker value={color} onChange={setColor} palette={CATEGORY_COLORS} />
        <IconPicker value={icon} onChange={setIcon} color={color} />
      </form>
    </Sheet>
  );
}

const ICON_LABELS: Record<string, string> = {
  "shopping-cart": "Caddie",
  home: "Maison",
  car: "Voiture",
  "gamepad-2": "Jeux",
  "heart-pulse": "Santé",
  repeat: "Abonnement",
  "shopping-bag": "Sac",
  utensils: "Restaurant",
  plane: "Avion",
  "circle-ellipsis": "Autres",
  briefcase: "Mallette",
  coins: "Pièces",
  wallet: "Portefeuille",
  "piggy-bank": "Tirelire",
  "trending-up": "Hausse",
  gift: "Cadeau",
  "graduation-cap": "Études",
  baby: "Enfant",
  "paw-print": "Animaux",
  shirt: "Vêtements",
  fuel: "Carburant",
  train: "Train",
  zap: "Énergie",
  smartphone: "Téléphone",
  "book-open": "Livre",
  dumbbell: "Sport",
  tag: "Étiquette",
};

function IconPicker({ value, onChange, color }: { value: string; onChange: (icon: string) => void; color: string }) {
  const labelId = useId();
  // Une icône hors liste (valeur ancienne en base) reste sélectionnable telle quelle.
  const names: readonly string[] = CATEGORY_ICON_NAMES.includes(value as (typeof CATEGORY_ICON_NAMES)[number])
    ? CATEGORY_ICON_NAMES
    : [value, ...CATEGORY_ICON_NAMES];
  return (
    <div className="space-y-1.5">
      <p id={labelId} className="text-[13px] font-medium text-fg">
        Icône
      </p>
      <div role="radiogroup" aria-labelledby={labelId} className="grid grid-cols-7 gap-1.5 sm:grid-cols-9">
        {names.map((n) => {
          const active = n === value;
          const Icon = categoryIconComponent(n);
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={ICON_LABELS[n] ?? n}
              title={ICON_LABELS[n] ?? n}
              onClick={() => onChange(n)}
              style={active ? { color, backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)` } : undefined}
              className={cn(
                "inline-flex aspect-square items-center justify-center rounded-lg border text-muted transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                active ? "border-current" : "border-border hover:bg-surface-2 hover:text-fg",
              )}
            >
              <Icon aria-hidden className="size-[18px]" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
