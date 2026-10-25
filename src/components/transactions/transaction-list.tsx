"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  FileUp,
  Plus,
  ReceiptText,
  RotateCcw,
  Scale,
  SearchX,
  StickyNote,
  type LucideIcon,
} from "lucide-react";
import { Amount } from "@/components/amount";
import { CategoryIcon } from "@/components/category-icon";
import { useQuickAdd } from "@/components/quick-add/quick-add-provider";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";
import { formatDateLong } from "@/lib/format";
import type { TransactionRow } from "@/lib/queries/transactions";
import { Filters, SearchField, filtersHref, type FilterState } from "./filters";
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

function groupByDay(rows: TransactionRow[]): { date: string; rows: TransactionRow[] }[] {
  const groups: { date: string; rows: TransactionRow[] }[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.date === row.date) last.rows.push(row);
    else groups.push({ date: row.date, rows: [row] });
  }
  return groups;
}

/** Écran Activité : filtres, totaux, liste groupée par jour, feuilles de modification et d'import. */
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

  // Ajout : la saisie rapide globale (même feuille que le raccourci « N »), compte filtré présélectionné.
  const { open: openQuickAdd } = useQuickAdd();
  const openAdd = () => openQuickAdd(filters.accountId === null ? undefined : { accountId: filters.accountId });
  const openEdit = (transaction: TransactionRow) =>
    setDialog((d) => ({ nonce: d.nonce + 1, open: true, transaction }));
  const closeDialog = () => setDialog((d) => ({ ...d, open: false }));
  const openImport = () => setImportState((s) => ({ nonce: s.nonce + 1, open: true }));

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
      <header className="flex flex-col gap-4">
        <div className="space-y-1">
          <p className="text-[13px] text-muted">
            {count === 0 ? "Aucune opération" : `${count}${truncated ? "+" : ""} ${count > 1 ? "opérations" : "opération"}`}
          </p>
          <h1 className="text-2xl font-semibold tracking-[-0.025em] text-fg max-md:sr-only md:text-[28px]">Activité</h1>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <SearchField {...filters} currentMonth={currentMonth} className="sm:min-w-56 sm:flex-1" />
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={openImport}>
              <FileUp aria-hidden />
              Importer un relevé
            </Button>
            {/* Sur téléphone, l'ajout passe par le « + » global. */}
            <Button variant="secondary" onClick={openAdd} aria-keyshortcuts="N" className="max-md:hidden">
              <Plus aria-hidden />
              Ajouter
            </Button>
          </div>
        </div>
      </header>

      <Filters {...filters} currentMonth={currentMonth} accounts={accounts} categories={categories} />

      <dl className="grid grid-cols-3 gap-2 sm:gap-3">
        <Total tone="positive" label="Revenus" icon={ArrowDownLeft} value={<Amount cents={income} />} />
        <Total tone="neutral" label="Dépenses" icon={ArrowUpRight} value={<Amount cents={Math.abs(expenses)} />} />
        <Total tone="brand" label="Solde" icon={Scale} value={<Amount cents={income + expenses} tone="signed" className="text-fg!" />} />
      </dl>

      {count === 0 ? (
        hasFilter ? (
          <EmptyState
            icon={SearchX}
            title="Aucune opération ne correspond"
            description="Modifiez la recherche, le compte ou la catégorie, ou changez de mois."
            action={
              <Link
                href={filtersHref("/transactions", { ...filters, accountId: null, categoryId: null, q: "" }, currentMonth)}
                className={buttonClasses({ variant: "secondary" })}
                scroll={false}
              >
                <RotateCcw aria-hidden />
                Réinitialiser les filtres
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={ReceiptText}
            title="Aucune opération pour ce mois"
            description="Saisissez une opération ou importez un relevé bancaire au format CSV."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={openAdd}>
                  <Plus aria-hidden />
                  Ajouter une opération
                </Button>
                <Button variant="secondary" onClick={openImport}>
                  <FileUp aria-hidden />
                  Importer un relevé
                </Button>
              </div>
            }
          />
        )
      ) : (
        <div className="space-y-4">
          {groups.map((g) => {
            const dayTotal = g.rows.reduce((sum, t) => sum + t.amount, 0);
            return (
              <section key={g.date} aria-label={formatDateLong(g.date)}>
                <div className="sticky top-[var(--mobile-header-h)] z-10 -mx-4 flex items-baseline justify-between gap-3 bg-bg/90 px-5 py-2 backdrop-blur-md sm:-mx-6 sm:px-7 md:top-16 md:mx-0 md:rounded-xl md:px-3">
                  <h2 className="text-[13px] font-bold text-fg first-letter:uppercase">{formatDateLong(g.date)}</h2>
                  <Amount cents={dayTotal} tone="signed" className="text-[12px] font-medium text-muted" />
                </div>
                <Card className="p-1.5">
                  <ul>
                    {g.rows.map((t) => (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => openEdit(t)}
                          className="flex min-h-14 w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                        >
                          <CategoryIcon icon={t.categoryIcon} color={t.categoryColor} tinted />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-[15px] font-semibold text-fg">{t.label}</span>
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
                          <Amount cents={t.amount} tone="signed" className="shrink-0 text-[15px] font-semibold" />
                          <ChevronRight aria-hidden className="hidden size-4 shrink-0 text-subtle sm:block" />
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

      {dialog.transaction && (
        <TransactionDialog
          key={`tx-${dialog.nonce}`}
          open={dialog.open}
          onClose={closeDialog}
          accounts={accounts}
          categories={categories}
          transaction={dialog.transaction}
          today={today}
        />
      )}
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

function Total({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  icon: LucideIcon;
  tone: "positive" | "neutral" | "brand";
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-card p-3 sm:p-4",
        tone === "positive" && "bg-positive-soft",
        tone === "neutral" && "border border-border bg-surface shadow-soft",
        tone === "brand" && "bg-brand-soft",
      )}
    >
      <dt
        className={cn(
          "flex items-center gap-2 text-[12px] font-semibold sm:text-[13px]",
          tone === "positive" && "text-positive",
          tone === "neutral" && "text-muted",
          tone === "brand" && "text-brand",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "hidden size-7 shrink-0 items-center justify-center rounded-full sm:inline-flex",
            tone === "neutral" ? "bg-surface-2" : "bg-surface/70",
          )}
        >
          <Icon className="size-3.5" />
        </span>
        {label}
      </dt>
      <dd className="num whitespace-nowrap text-[15px] font-bold tracking-[-0.02em] text-fg sm:text-[17px]">{value}</dd>
    </div>
  );
}
