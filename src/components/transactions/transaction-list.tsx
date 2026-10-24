"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, ReceiptText, SearchX, StickyNote, Upload } from "lucide-react";
import { Amount } from "@/components/amount";
import { CategoryIcon } from "@/components/category-icon";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateLong } from "@/lib/format";
import type { TransactionRow } from "@/lib/queries/transactions";
import { Filters, type FilterState } from "./filters";
import { ImportWizard } from "./import-wizard";
import { TransactionDialog, type AccountOption, type CategoryOption } from "./transaction-dialog";

export type TransactionListProps = {
  transactions: TransactionRow[];
  accounts: AccountOption[];
  categories: CategoryOption[];
  filters: FilterState;
  /** Mois courant « YYYY-MM » (valeur par défaut du filtre de mois). */
  currentMonth: string;
  /** Date du jour « YYYY-MM-DD ». */
  today: string;
  /** Vrai si la liste a été tronquée à la limite de lecture. */
  truncated: boolean;
};

type DialogState = { nonce: number; open: boolean; transaction: TransactionRow | null };

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

function groupByDay(rows: TransactionRow[]): { date: string; rows: TransactionRow[] }[] {
  const groups: { date: string; rows: TransactionRow[] }[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.date === row.date) last.rows.push(row);
    else groups.push({ date: row.date, rows: [row] });
  }
  return groups;
}

/** Écran Transactions : filtres, totaux, liste groupée par jour, dialogues d'ajout et d'import. */
export function TransactionList({
  transactions,
  accounts,
  categories,
  filters,
  currentMonth,
  today,
  truncated,
}: TransactionListProps) {
  const [dialog, setDialog] = useState<DialogState>({ nonce: 0, open: false, transaction: null });
  const [importState, setImportState] = useState({ nonce: 0, open: false });

  const openAdd = () => setDialog((d) => ({ nonce: d.nonce + 1, open: true, transaction: null }));
  const openEdit = (transaction: TransactionRow) =>
    setDialog((d) => ({ nonce: d.nonce + 1, open: true, transaction }));
  const closeDialog = () => setDialog((d) => ({ ...d, open: false }));
  const openImport = () => setImportState((s) => ({ nonce: s.nonce + 1, open: true }));

  // Raccourci « N » : nouvelle transaction, hors champ de saisie et hors dialogue ouvert.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== "n" || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (isTypingTarget(e.target) || document.querySelector("dialog[open]")) return;
      e.preventDefault();
      openAdd();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const { income, expenses } = useMemo(() => {
    let inc = 0;
    let exp = 0;
    for (const t of transactions) {
      if (t.amount > 0) inc += t.amount;
      else exp += t.amount;
    }
    return { income: inc, expenses: exp };
  }, [transactions]);
  const groups = useMemo(() => groupByDay(transactions), [transactions]);

  const hasFilter = filters.accountId !== null || filters.categoryId !== null || filters.q.trim() !== "";
  const count = transactions.length;

  return (
    <div className="space-y-5 sm:space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <p className="text-[13px] text-muted">
            {count === 0 ? "Aucune opération" : `${count}${truncated ? "+" : ""} ${count > 1 ? "opérations" : "opération"}`}
          </p>
          <h1 className="text-2xl font-semibold tracking-[-0.025em] text-fg sm:text-[28px]">Transactions</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={openImport}>
            <Upload aria-hidden />
            Importer
          </Button>
          <Button onClick={openAdd} aria-keyshortcuts="N">
            <Plus aria-hidden />
            Ajouter
            <kbd
              aria-hidden
              className="ml-1 hidden rounded border border-accent-fg/30 px-1 font-sans text-[11px] leading-4 opacity-80 md:inline"
            >
              N
            </kbd>
          </Button>
        </div>
      </header>

      <Filters
        {...filters}
        currentMonth={currentMonth}
        accounts={accounts}
        categories={categories}
      />

      <Card className="grid grid-cols-3 divide-x divide-border">
        <Total label="Revenus" value={<Amount cents={income} tone={income > 0 ? "signed" : "plain"} />} />
        <Total label="Dépenses" value={<Amount cents={Math.abs(expenses)} />} />
        <Total label="Solde" value={<Amount cents={income + expenses} tone="signed" />} />
      </Card>

      {count === 0 ? (
        hasFilter ? (
          <EmptyState
            icon={SearchX}
            title="Aucune transaction ne correspond"
            description="Modifiez la recherche, le compte ou la catégorie, ou changez de mois."
          />
        ) : (
          <EmptyState
            icon={ReceiptText}
            title="Aucune transaction pour ce mois"
            description="Saisissez une opération ou importez un relevé bancaire au format CSV."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={openAdd}>
                  <Plus aria-hidden />
                  Ajouter une transaction
                </Button>
                <Button variant="secondary" onClick={openImport}>
                  <Upload aria-hidden />
                  Importer un relevé
                </Button>
              </div>
            }
          />
        )
      ) : (
        <div className="space-y-5">
          {groups.map((g) => {
            const dayTotal = g.rows.reduce((sum, t) => sum + t.amount, 0);
            return (
              <section key={g.date} aria-label={formatDateLong(g.date)}>
                <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
                  <h3 className="text-[13px] font-medium text-muted first-letter:uppercase">
                    {formatDateLong(g.date)}
                  </h3>
                  <Amount cents={dayTotal} tone="signed" className="text-[12px] text-subtle" />
                </div>
                <Card className="p-1.5">
                  <ul>
                    {g.rows.map((t) => (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => openEdit(t)}
                          className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                        >
                          <CategoryIcon icon={t.categoryIcon} color={t.categoryColor} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-medium text-fg">{t.label}</span>
                              {t.note && (
                                <span title={t.note} className="shrink-0 text-subtle">
                                  <StickyNote aria-hidden className="size-3.5" />
                                  <span className="sr-only">Contient une note : {t.note}</span>
                                </span>
                              )}
                            </span>
                            <span className="block truncate text-[12px] text-muted">
                              {t.categoryName ?? "Sans catégorie"} · {t.accountName}
                            </span>
                          </span>
                          <Amount cents={t.amount} tone="signed" className="shrink-0 text-sm font-medium" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </Card>
              </section>
            );
          })}
          {truncated && (
            <p className="text-center text-[13px] text-muted">
              Seules les {count} opérations les plus récentes sont affichées. Affinez les filtres pour voir les autres.
            </p>
          )}
        </div>
      )}

      <TransactionDialog
        key={`tx-${dialog.nonce}`}
        open={dialog.open}
        onClose={closeDialog}
        accounts={accounts}
        categories={categories}
        transaction={dialog.transaction}
        today={today}
        defaultAccountId={filters.accountId ?? undefined}
      />
      <ImportWizard
        key={`import-${importState.nonce}`}
        open={importState.open}
        onClose={() => setImportState((s) => ({ ...s, open: false }))}
        accounts={accounts}
        categories={categories}
        defaultAccountId={filters.accountId ?? undefined}
      />
    </div>
  );
}

function Total({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1 px-4 py-3.5 sm:px-6 sm:py-4">
      <p className="text-[12px] font-medium text-muted sm:text-[13px]">{label}</p>
      <p className="num text-base font-semibold tracking-[-0.02em] text-fg sm:text-xl">{value}</p>
    </div>
  );
}
