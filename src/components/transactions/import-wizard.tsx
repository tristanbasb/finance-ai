"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Sparkles, Upload } from "lucide-react";
import { Amount } from "@/components/amount";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import {
  decodeCsvBytes,
  guessMapping,
  mapRows,
  parseCsv,
  type CsvMapping,
} from "@/lib/csv";
import { formatDateShort } from "@/lib/format";
import { importInBatches } from "@/lib/import-batches";
import type { AccountOption, CategoryOption } from "./transaction-dialog";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const PREVIEW_ROWS = 20;
const IMPORT_BATCH = 5000;
const AI_BATCH = 500;

type Cols = { date: string; label: string; amount: string; debit: string; credit: string };
type AmountMode = "single" | "split";
type Parsed = { fileName: string; headers: string[]; rows: string[][] };

const rowSelectClasses =
  "h-8 w-full max-w-64 cursor-pointer rounded-md border border-border bg-surface px-2 text-[13px] text-fg " +
  "hover:border-border-strong focus-visible:border-accent focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-accent/20";

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    /* corps absent ou illisible */
  }
  return "Une erreur est survenue.";
}

function toIndex(value: string): number | undefined {
  return value === "" ? undefined : Number(value);
}

export type ImportWizardProps = {
  open: boolean;
  onClose: () => void;
  accounts: AccountOption[];
  categories: CategoryOption[];
  defaultAccountId?: number;
};

/**
 * Assistant d'import CSV en deux étapes : fichier, puis colonnes + aperçu + compte (+ catégorisation IA).
 * Le parent change la `key` à chaque ouverture pour repartir d'un assistant neuf.
 */
export function ImportWizard({ open, onClose, accounts, categories, defaultAccountId }: ImportWizardProps) {
  const router = useRouter();
  const activeAccounts = useMemo(() => accounts.filter((a) => !a.archived), [accounts]);

  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [mode, setMode] = useState<AmountMode>("single");
  const [cols, setCols] = useState<Cols>({ date: "", label: "", amount: "", debit: "", credit: "" });
  const [accountId, setAccountId] = useState(() => {
    const preferred = activeAccounts.find((a) => a.id === defaultAccountId) ?? activeAccounts[0];
    return preferred ? String(preferred.id) : "";
  });
  // Catégorie choisie par ligne valide (indice dans `valid`), par l'IA ou à la main.
  const [cats, setCats] = useState<Record<number, number | null>>({});
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  // Lignes déjà enregistrées par un import interrompu : une reprise n'envoie que le reste.
  const [importedCount, setImportedCount] = useState(0);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/ai/status", { signal: controller.signal, cache: "no-store" });
        const body = res.ok ? ((await res.json()) as { enabled?: unknown }) : null;
        setAiEnabled(body?.enabled === true);
      } catch {
        if (!controller.signal.aborted) setAiEnabled(false);
      }
    })();
    return () => controller.abort();
  }, [open]);

  const mapping: CsvMapping | null = useMemo(() => {
    const date = toIndex(cols.date);
    const label = toIndex(cols.label);
    if (date === undefined || label === undefined) return null;
    if (mode === "single") {
      const amount = toIndex(cols.amount);
      return amount === undefined ? null : { date, label, amount };
    }
    const debit = toIndex(cols.debit);
    const credit = toIndex(cols.credit);
    return debit === undefined && credit === undefined ? null : { date, label, debit, credit };
  }, [cols, mode]);

  const result = useMemo(
    () => (parsed && mapping ? mapRows(parsed.rows, mapping) : null),
    [parsed, mapping],
  );
  const valid = result?.valid ?? [];
  const busy = aiBusy || importing;
  // Après un import partiel, le contenu est figé : seule la reprise ou un nouveau fichier est possible.
  const locked = busy || importedCount > 0;

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setFileError(null);
    if (file.size > MAX_FILE_BYTES) {
      setFileError("Ce fichier dépasse 10 Mo. Découpez-le en plusieurs relevés.");
      return;
    }
    try {
      const { headers, rows } = parseCsv(decodeCsvBytes(await file.arrayBuffer()));
      if (headers.length === 0 || rows.length === 0) {
        setFileError("Le fichier ne contient aucune ligne exploitable.");
        return;
      }
      const guess = guessMapping(headers);
      const str = (n: number | undefined) => (n === undefined ? "" : String(n));
      setMode(guess.debit !== undefined || guess.credit !== undefined ? "split" : "single");
      setCols({
        date: str(guess.date),
        label: str(guess.label),
        amount: str(guess.amount),
        debit: str(guess.debit),
        credit: str(guess.credit),
      });
      setCats({});
      setParsed({ fileName: file.name, headers, rows });
    } catch {
      setFileError("Impossible de lire ce fichier.");
    }
  }

  function updateCols(patch: Partial<Cols>) {
    setCols((c) => ({ ...c, ...patch }));
    setCats({});
  }

  const kindFor = (amount: number) => (amount < 0 ? "expense" : "income");

  async function categorize() {
    if (!result) return;
    const labels = result.valid.map((t) => t.label);
    setAiBusy(true);
    try {
      const ids: (number | null)[] = [];
      for (let i = 0; i < labels.length; i += AI_BATCH) {
        const res = await fetch("/api/ai/categorize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ labels: labels.slice(i, i + AI_BATCH) }),
        });
        if (!res.ok) throw new Error(await errorMessage(res));
        const body = (await res.json()) as { categoryIds?: unknown };
        const chunk = body.categoryIds;
        if (!Array.isArray(chunk) || chunk.length !== Math.min(AI_BATCH, labels.length - i)) {
          throw new Error("Réponse inattendue");
        }
        ids.push(...chunk.map((v) => (typeof v === "number" ? v : null)));
      }
      setCats((current) => {
        const next = { ...current };
        result.valid.forEach((t, index) => {
          if (next[index]) return; // un choix manuel est conservé
          const category = categories.find((c) => c.id === ids[index]);
          if (category && category.kind === kindFor(t.amount)) {
            next[index] = category.id;
          }
        });
        return next;
      });
      toast.success("Catégorisation terminée", {
        description: "Vérifiez les catégories proposées dans l'aperçu avant d'importer.",
      });
    } catch {
      toast.error("Catégorisation IA indisponible", {
        description: "Les transactions seront importées sans catégorie.",
      });
    } finally {
      setAiBusy(false);
    }
  }

  async function runImport() {
    if (!result || result.valid.length === 0 || accountId === "") return;
    const rows = result.valid.map((t, index) => ({
      date: t.date,
      label: t.label.slice(0, 200).trim(),
      amount: t.amount,
      ...(cats[index] ? { categoryId: cats[index] } : {}),
    }));
    setImporting(true);
    try {
      const { imported, error } = await importInBatches(
        rows,
        IMPORT_BATCH,
        async (chunk) => {
          const res = await fetch("/api/transactions/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accountId: Number(accountId), rows: chunk }),
          });
          if (!res.ok) throw new Error(await errorMessage(res));
        },
        importedCount,
      );
      setImportedCount(imported);
      if (error === undefined) {
        toast.success(`${imported} ${imported > 1 ? "transactions importées" : "transaction importée"}`);
        onClose();
        router.refresh();
        return;
      }
      const reason = error instanceof Error ? error.message : "Le serveur est injoignable.";
      toast.error(imported > 0 ? `Import interrompu après ${imported} transactions` : "Import impossible", {
        description:
          imported > 0
            ? `${reason} Ces ${imported} transactions sont enregistrées : utilisez « Reprendre l'import » pour envoyer le reste.`
            : reason,
      });
      if (imported > 0) router.refresh();
    } finally {
      setImporting(false);
    }
  }

  function restart() {
    setParsed(null);
    setImportedCount(0);
  }

  const remaining = valid.length - importedCount;

  const columnOptions = (parsed?.headers ?? []).map((h, i) => ({
    value: i,
    label: h === "" ? `Colonne ${i + 1}` : h,
  }));

  const footer = parsed ? (
    <>
      <Button variant="secondary" onClick={restart} disabled={busy}>
        {importedCount > 0 ? "Abandonner et changer de fichier" : "Changer de fichier"}
      </Button>
      <Button
        onClick={runImport}
        loading={importing}
        disabled={aiBusy || valid.length === 0 || accountId === ""}
      >
        {valid.length === 0
          ? "Importer"
          : importedCount > 0
            ? `Reprendre l'import (${remaining} ${remaining > 1 ? "restantes" : "restante"})`
            : `Importer ${valid.length} ${valid.length > 1 ? "transactions" : "transaction"}`}
      </Button>
    </>
  ) : (
    <Button variant="secondary" onClick={onClose}>
      Annuler
    </Button>
  );

  return (
    <Dialog
      open={open}
      onClose={busy ? () => undefined : onClose}
      size="lg"
      title="Importer un relevé"
      description={
        parsed
          ? `${parsed.fileName} · ${parsed.rows.length} ${parsed.rows.length > 1 ? "lignes" : "ligne"}`
          : "Fichier CSV exporté depuis votre banque (séparateur « ; », « , » ou tabulation)."
      }
      footer={footer}
    >
      {!parsed ? (
        <div className="space-y-3">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong px-6 py-10 text-center transition-colors hover:bg-surface-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring">
            <span className="inline-flex size-10 items-center justify-center rounded-full bg-accent-soft text-accent">
              <Upload aria-hidden className="size-5" />
            </span>
            <span className="text-sm font-medium text-fg">Choisir un fichier CSV</span>
            <span className="text-[13px] text-muted">UTF-8 ou Latin-1, 10 Mo au maximum</span>
            <input
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              onChange={onFile}
              className="sr-only"
              aria-label="Fichier CSV à importer"
            />
          </label>
          {fileError && (
            <p role="alert" className="flex items-start gap-2 text-[13px] text-danger">
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {fileError}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {importedCount > 0 && (
            <p
              role="status"
              className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2.5 text-[13px] text-fg"
            >
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
              <span>
                <strong className="font-semibold">{importedCount}</strong> sur {valid.length} transactions déjà
                importées. Reprenez l&apos;import pour envoyer les {remaining} restantes, sans doublon.
              </span>
            </p>
          )}
          <section aria-labelledby="import-cols" className="space-y-3">
            <h3 id="import-cols" className="text-[13px] font-semibold text-fg">
              1. Colonnes
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select
                label="Date"
                value={cols.date}
                onChange={(e) => updateCols({ date: e.target.value })}
                options={columnOptions}
                placeholder="Choisir une colonne"
                disabled={locked}
              />
              <Select
                label="Libellé"
                value={cols.label}
                onChange={(e) => updateCols({ label: e.target.value })}
                options={columnOptions}
                placeholder="Choisir une colonne"
                disabled={locked}
              />
              <Select
                label="Format des montants"
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value as AmountMode);
                  setCats({});
                }}
                options={[
                  { value: "single", label: "Une colonne Montant (signé)" },
                  { value: "split", label: "Colonnes Débit et Crédit" },
                ]}
                disabled={locked}
                wrapperClassName={mode === "single" ? undefined : "sm:col-span-2"}
              />
              {mode === "single" ? (
                <Select
                  label="Montant"
                  value={cols.amount}
                  onChange={(e) => updateCols({ amount: e.target.value })}
                  options={columnOptions}
                  placeholder="Choisir une colonne"
                  disabled={locked}
                />
              ) : (
                <>
                  <Select
                    label="Débit (sorties)"
                    value={cols.debit}
                    onChange={(e) => updateCols({ debit: e.target.value })}
                    options={columnOptions}
                    placeholder="Aucune"
                    disabled={locked}
                  />
                  <Select
                    label="Crédit (entrées)"
                    value={cols.credit}
                    onChange={(e) => updateCols({ credit: e.target.value })}
                    options={columnOptions}
                    placeholder="Aucune"
                    disabled={locked}
                  />
                </>
              )}
            </div>
          </section>

          <section aria-labelledby="import-preview" className="space-y-3">
            <h3 id="import-preview" className="text-[13px] font-semibold text-fg">
              2. Aperçu
            </h3>
            {!result ? (
              <p className="rounded-lg bg-surface-2 px-3 py-2.5 text-[13px] text-muted">
                Choisissez les colonnes date, libellé et montant pour voir l&apos;aperçu.
              </p>
            ) : (
              <>
                <p role="status" className="text-[13px] text-muted">
                  <strong className="font-semibold text-fg">{valid.length}</strong>{" "}
                  {valid.length > 1 ? "lignes valides" : "ligne valide"}
                  {result.errors.length > 0 && (
                    <>
                      {" · "}
                      <strong className="font-semibold text-fg">{result.errors.length}</strong>{" "}
                      {result.errors.length > 1 ? "ignorées" : "ignorée"}
                    </>
                  )}
                </p>
                {result.errors.length > 0 && (
                  <details className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-[13px]">
                    <summary className="cursor-pointer font-medium text-fg">
                      Voir les lignes ignorées
                    </summary>
                    <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-muted">
                      {result.errors.map((err) => (
                        <li key={err.line}>
                          Ligne {err.line} : {err.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {valid.length > 0 && (
                  <ul
                    aria-label="Aperçu des premières lignes"
                    className="divide-y divide-border rounded-lg border border-border"
                  >
                    {valid.slice(0, PREVIEW_ROWS).map((t, index) => (
                      <li key={index} className="space-y-1.5 px-3 py-2.5">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 truncate text-[13px] font-medium text-fg" title={t.label}>
                            {t.label}
                          </span>
                          <Amount cents={t.amount} tone="signed" className="shrink-0 text-[13px] font-medium" />
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="num w-12 shrink-0 text-[12px] text-muted">{formatDateShort(t.date)}</span>
                          <select
                            aria-label={`Catégorie de « ${t.label} »`}
                            className={rowSelectClasses}
                            value={cats[index] ? String(cats[index]) : ""}
                            disabled={locked}
                            onChange={(e) =>
                              setCats((c) => ({
                                ...c,
                                [index]: e.target.value === "" ? null : Number(e.target.value),
                              }))
                            }
                          >
                            <option value="">Sans catégorie</option>
                            {categories
                              .filter((c) => c.kind === kindFor(t.amount))
                              .map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                          </select>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {valid.length > PREVIEW_ROWS && (
                  <p className="text-[12px] text-subtle">
                    + {valid.length - PREVIEW_ROWS} autres lignes importées de la même façon.
                  </p>
                )}
              </>
            )}
          </section>

          <section aria-labelledby="import-target" className="space-y-3">
            <h3 id="import-target" className="text-[13px] font-semibold text-fg">
              3. Compte de destination
            </h3>
            <Select
              aria-label="Compte de destination"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              options={activeAccounts.map((a) => ({ value: a.id, label: a.name }))}
              placeholder={activeAccounts.length === 0 ? "Aucun compte disponible" : undefined}
              disabled={locked}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                onClick={categorize}
                loading={aiBusy}
                disabled={aiEnabled !== true || valid.length === 0 || locked}
                title={aiEnabled === false ? "IA non configurée" : undefined}
              >
                <Sparkles aria-hidden />
                Catégoriser avec l&apos;IA
              </Button>
              {aiEnabled === false && (
                <span className="text-[13px] text-muted">IA non configurée</span>
              )}
            </div>
          </section>
        </div>
      )}
    </Dialog>
  );
}
