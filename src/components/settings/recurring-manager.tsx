"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, Pause, Pencil, Plus, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { centsToInput } from "@/lib/amount-input";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/http";
import { formatEUR, parseAmount } from "@/lib/money";
import { frequencyLabel } from "@/lib/settings-ui";
import { RecurringDialog, type RecurringRow } from "./recurring-dialog";
import type { AccountRow, CategoryRow } from "./types";

const MAX_CENTS = 99_999_999_999;

type DialogState = { nonce: number; open: boolean; recurring: RecurringRow | null };

export type RecurringManagerProps = {
  items: RecurringRow[];
  /** Catégories de dépenses. */
  categories: Pick<CategoryRow, "id" | "name" | "color">[];
  /** Tous les comptes (les archivés servent à afficher le nom ; seuls les autres sont proposés). */
  accounts: Pick<AccountRow, "id" | "name" | "type" | "archived" | "color">[];
  /** Marge de sécurité (centimes). */
  margin: number;
};

/** Section « Dépenses récurrentes » des réglages : liste, dialogue et marge de sécurité. */
export function RecurringManager({ items, categories, accounts, margin }: RecurringManagerProps) {
  const [dialog, setDialog] = useState<DialogState>({ nonce: 0, open: false, recurring: null });
  const openAdd = () => setDialog((d) => ({ nonce: d.nonce + 1, open: true, recurring: null }));
  const openEdit = (recurring: RecurringRow) => setDialog((d) => ({ nonce: d.nonce + 1, open: true, recurring }));
  const closeDialog = () => setDialog((d) => ({ ...d, open: false }));

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  return (
    <Card id="recurrentes" className="scroll-mt-section">
      <CardHeader
        action={
          <Button size="sm" onClick={openAdd}>
            <Plus aria-hidden />
            Ajouter
          </Button>
        }
      >
        <CardTitle className="flex items-center gap-2">
          <CalendarClock aria-hidden className="size-4 text-muted" />
          Dépenses récurrentes
        </CardTitle>
        <CardDescription>
          Loyer, abonnements, assurances : ce qui revient chaque mois ou chaque année, pour prévoir votre fin de mois.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {items.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="Aucune dépense récurrente"
            description="Ajoutez vos prélèvements réguliers pour savoir ce qu'il vous restera en fin de mois."
            action={
              <Button onClick={openAdd}>
                <Plus aria-hidden />
                Ajouter
              </Button>
            }
          />
        ) : (
          <ul className="-mx-2 divide-y divide-border">
            {items.map((r) => {
              const category = r.categoryId != null ? categoryById.get(r.categoryId) : undefined;
              const account = accountById.get(r.accountId);
              return (
                <li key={r.id} className="py-1 first:pt-0 last:pb-0">
                  <button
                    type="button"
                    onClick={() => openEdit(r)}
                    aria-label={`Modifier la dépense récurrente ${r.label}`}
                    className={cn(
                      "group flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-2.5 text-left",
                      "transition-colors duration-150 hover:bg-surface-2",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    )}
                  >
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: category?.color ?? "var(--color-border-strong)", opacity: r.active ? 1 : 0.5 }}
                    />
                    <span className="min-w-0 flex-1 space-y-0.5">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className={cn("truncate text-sm font-medium", r.active ? "text-fg" : "text-muted")}>
                          {r.label}
                        </span>
                        {!r.active && (
                          <Badge variant="warning" className="shrink-0">
                            <Pause aria-hidden />
                            En pause
                          </Badge>
                        )}
                      </span>
                      <span className="block text-[12px] text-muted">{frequencyLabel(r.frequency, r.anchorMonth)}</span>
                      <span className="block truncate text-[12px] text-subtle">
                        {category?.name ?? "Sans catégorie"} · {account?.name ?? "Compte inconnu"}
                      </span>
                    </span>
                    <span className={cn("num shrink-0 text-sm font-semibold", r.active ? "text-fg" : "text-muted")}>
                      {formatEUR(r.amount)}
                    </span>
                    <Pencil aria-hidden className="size-4 shrink-0 text-subtle transition-colors group-hover:text-fg" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <MarginField key={margin} initial={margin} />
      </CardContent>

      <RecurringDialog
        key={`recurring-${dialog.nonce}`}
        open={dialog.open}
        onClose={closeDialog}
        recurring={dialog.recurring}
        categories={categories}
        accounts={accounts}
      />
    </Card>
  );
}

/** « Marge de sécurité » : somme à garder en fin de mois, en euros. */
function MarginField({ initial }: { initial: number }) {
  const router = useRouter();
  const formId = useId();
  const [value, setValue] = useState(centsToInput(initial));
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = value.trim() === "" ? null : parseAmount(value);
    if (parsed === null) return setError("Montant illisible. Exemple : 200 ou 150,50.");
    if (parsed < 0) return setError("La marge ne peut pas être négative.");
    if (parsed > MAX_CENTS) return setError("Montant trop élevé.");
    setError(undefined);
    setSaving(true);
    try {
      const res = await fetch("/api/settings/forecast-margin", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ margin: parsed }),
      });
      if (!res.ok) {
        toast.error("Marge non enregistrée", { description: await errorMessage(res) });
        return;
      }
      const body = (await res.json()) as { margin?: unknown };
      if (typeof body.margin === "number") setValue(centsToInput(body.margin));
      toast.success("Marge enregistrée");
      router.refresh();
    } catch {
      toast.error("Marge non enregistrée", { description: "Le serveur est injoignable." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      id={formId}
      onSubmit={submit}
      noValidate
      className="rounded-xl border border-border bg-surface-2/50 p-4"
      aria-labelledby={`${formId}-title`}
    >
      <h3 id={`${formId}-title`} className="flex items-center gap-2 text-sm font-semibold text-fg">
        <ShieldCheck aria-hidden className="size-4 text-positive" />
        Marge de sécurité
      </h3>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start">
        <Input
          label="Montant (€)"
          inputMode="decimal"
          autoComplete="off"
          placeholder="200,00"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          error={error}
          hint={error ? undefined : "Montant à garder en fin de mois quand vous vérifiez un achat."}
          wrapperClassName="sm:max-w-xs sm:flex-1"
        />
        <Button type="submit" loading={saving} className="sm:mt-[26px]">
          <Check aria-hidden />
          Enregistrer
        </Button>
      </div>
    </form>
  );
}
