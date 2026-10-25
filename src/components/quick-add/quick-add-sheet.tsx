"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, FileUp, PenLine, RotateCcw, RotateCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import type { AccountOption, CategoryOption } from "@/components/transactions/transaction-fields";
import { cn } from "@/lib/cn";
import { todayLocal } from "@/lib/dates";
import { errorMessage } from "@/lib/http";
import {
  defaultAccountId,
  proposalToFormValues,
  validateTransactionForm,
  type Proposal,
  type TransactionFormErrors,
  type TransactionFormValues,
} from "@/lib/quick-add";
import { ManualForm } from "./manual-form";
import { AnalysisError, PhraseInput, ProposalCard, ProposalSkeleton } from "./phrase-step";

export type QuickAddData = {
  accounts: AccountOption[];
  categories: CategoryOption[];
  aiEnabled: boolean;
};

type View = "phrase" | "analyzing" | "proposal" | "error" | "manual";

export type QuickAddSheetProps = {
  open: boolean;
  onClose: () => void;
  /** Comptes, catégories et état de l'IA ; `null` pendant le premier chargement. */
  data: QuickAddData | null;
  loadError: string | null;
  onRetryLoad: () => void;
  /**
   * Valeurs de départ : avec un montant, la proposition modifiable s'affiche directement ;
   * sans montant, le formulaire s'ouvre prérempli.
   */
  prefill?: Partial<Proposal>;
  onImport: () => void;
  /** Opération enregistrée (le parent notifie, rafraîchit et ferme). */
  onAdded: () => void;
};

const UNAVAILABLE = "L'analyse par Claude n'est pas disponible. Saisissez l'opération à la main.";

/**
 * Feuille « Nouvelle opération » : phrase libre analysée par Claude (si l'IA est active) avec
 * proposition modifiable, ou formulaire classique. Le parent change la `key` à chaque
 * ouverture : chaque ouverture repart de zéro.
 */
export function QuickAddSheet({
  open,
  onClose,
  data,
  loadError,
  onRetryLoad,
  prefill,
  onImport,
  onAdded,
}: QuickAddSheetProps) {
  const phraseFormId = useId();
  const proposalFormId = useId();
  const manualFormId = useId();

  const [view, setView] = useState<View | null>(null);
  const [text, setText] = useState("");
  const [phrase, setPhrase] = useState("");
  const [phraseError, setPhraseError] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [values, setValues] = useState<TransactionFormValues | null>(null);
  const [errors, setErrors] = useState<TransactionFormErrors>({});
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [aiUnavailable, setAiUnavailable] = useState(false);
  const [restarted, setRestarted] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const accounts = useMemo(() => (data?.accounts ?? []).filter((a) => !a.archived), [data]);
  const categories = data?.categories ?? [];
  const aiEnabled = !!data?.aiEnabled && !aiUnavailable;
  const defaults = useMemo(() => ({ today: todayLocal(), accountId: defaultAccountId(accounts) }), [accounts]);

  // Valeurs et vue initiales dérivées des données tant que l'utilisateur n'a rien changé.
  const currentValues = values ?? proposalToFormValues(prefill ?? {}, defaults);
  const initialView: View = prefill
    ? typeof prefill.amountCents === "number"
      ? "proposal"
      : "manual"
    : data?.aiEnabled
      ? "phrase"
      : "manual";
  const currentView = view ?? initialView;

  // Analyse abandonnée si la feuille se ferme ou est démontée.
  useEffect(() => {
    if (open) return;
    abortRef.current?.abort();
  }, [open]);
  useEffect(() => () => abortRef.current?.abort(), []);

  function goManual(nextNotice: string | null = null) {
    abortRef.current?.abort();
    setNotice(nextNotice);
    setErrors({});
    setView("manual");
  }

  function goPhrase() {
    abortRef.current?.abort();
    setNotice(null);
    setErrors({});
    setAnalysisError(null);
    setRestarted(true);
    setView("phrase");
  }

  async function analyze() {
    const trimmed = text.trim();
    if (trimmed === "") {
      setPhraseError("Écrivez une opération, par exemple « 12,50 resto midi ».");
      return;
    }
    setPhraseError(null);
    setAnalysisError(null);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setView("analyzing");

    try {
      const res = await fetch("/api/ai/parse-transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setPhrase(trimmed);
      if (res.ok) {
        const proposal = (await res.json()) as Proposal;
        if (controller.signal.aborted) return;
        setValues(proposalToFormValues(proposal, defaults));
        setErrors({});
        setView("proposal");
        return;
      }
      if (res.status === 422) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
          partial?: Partial<Proposal>;
        } | null;
        if (controller.signal.aborted) return;
        setValues(proposalToFormValues(body?.partial ?? {}, defaults));
        goManual(`${body?.error ?? "Je n'ai pas trouvé de montant."} Complétez le montant ci-dessous.`);
        return;
      }
      if (res.status === 503) {
        setAiUnavailable(true);
        goManual(UNAVAILABLE);
        return;
      }
      const message = await errorMessage(res);
      if (controller.signal.aborted) return;
      setAnalysisError(message);
      setView("error");
    } catch {
      if (controller.signal.aborted) return;
      setAnalysisError("Le serveur est injoignable. Réessayez dans un instant.");
      setView("error");
    }
  }

  async function add() {
    // Garde contre un double envoi (double clic, Entrée répétée) avant le rendu suivant.
    if (savingRef.current) return;
    const result = validateTransactionForm(currentValues);
    setErrors(result.ok ? {} : result.errors);
    if (!result.ok) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result.body),
      });
      if (!res.ok) {
        toast.error("Ajout impossible", {
          description: await errorMessage(res),
        });
        return;
      }
      onAdded();
    } catch {
      toast.error("Ajout impossible", {
        description: "Le serveur est injoignable.",
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const phraseMode = currentView === "phrase" || currentView === "analyzing" || currentView === "error";
  // En erreur, « Saisir à la main » est déjà proposé dans le pied de la feuille.
  const showModeLink = aiEnabled && currentView !== "error";

  let footer: React.ReactNode = null;
  if (data) {
    if (currentView === "phrase" || currentView === "analyzing") {
      footer = (
        <Button type="submit" form={phraseFormId} loading={currentView === "analyzing"}>
          {currentView !== "analyzing" && <Sparkles aria-hidden />}
          {currentView === "analyzing" ? "Analyse en cours…" : "Analyser"}
        </Button>
      );
    } else if (currentView === "error") {
      footer = (
        <FooterPair>
          <Button variant="secondary" onClick={() => goManual()}>
            <PenLine aria-hidden />
            Saisir à la main
          </Button>
          <Button onClick={analyze}>
            <RotateCw aria-hidden />
            Réessayer
          </Button>
        </FooterPair>
      );
    } else if (currentView === "proposal") {
      footer = (
        <FooterPair>
          {aiEnabled && (
            <Button variant="secondary" onClick={goPhrase} disabled={saving}>
              <RotateCcw aria-hidden />
              Recommencer
            </Button>
          )}
          <Button type="submit" form={proposalFormId} loading={saving}>
            {!saving && <Check aria-hidden />}
            Ajouter
          </Button>
        </FooterPair>
      );
    } else {
      footer = (
        <Button type="submit" form={manualFormId} loading={saving}>
          {!saving && <Check aria-hidden />}
          Ajouter
        </Button>
      );
    }
  }

  const status =
    currentView === "analyzing"
      ? "Analyse de la phrase en cours…"
      : currentView === "proposal" && phrase
        ? "Proposition prête. Vérifiez les champs avant d'ajouter."
        : "";

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Nouvelle opération"
      description={data && phraseMode ? "Écrivez-la en une phrase, Claude remplit les champs." : undefined}
      footer={footer}
    >
      <p aria-live="polite" className="sr-only">
        {status}
      </p>

      {!data ? (
        loadError ? (
          <div className="space-y-3">
            <AnalysisError message={loadError} />
            <Button variant="secondary" onClick={onRetryLoad}>
              <RotateCw aria-hidden />
              Réessayer
            </Button>
          </div>
        ) : (
          <div aria-busy className="space-y-3" role="status" aria-label="Chargement">
            <div className="h-24 animate-pulse rounded-2xl bg-surface-2" />
            <div className="flex gap-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-9 w-28 animate-pulse rounded-full bg-surface-2" />
              ))}
            </div>
          </div>
        )
      ) : (
        <>
          {phraseMode && (
            <>
              <PhraseInput
                id={phraseFormId}
                text={text}
                onTextChange={(t) => {
                  setText(t);
                  if (phraseError) setPhraseError(null);
                }}
                onSubmit={analyze}
                busy={currentView === "analyzing"}
                error={phraseError}
                active={open && currentView === "phrase"}
                selectOnFocus={restarted}
              />
              {currentView === "analyzing" && <ProposalSkeleton />}
              {currentView === "error" && analysisError && <AnalysisError message={analysisError} focusOnMount />}
            </>
          )}

          {currentView === "proposal" && (
            <ProposalCard
              id={proposalFormId}
              phrase={phrase}
              values={currentValues}
              onChange={setValues}
              errors={errors}
              accounts={accounts}
              categories={categories}
              onSubmit={add}
            />
          )}

          {currentView === "manual" && (
            <ManualForm
              id={manualFormId}
              values={currentValues}
              onChange={setValues}
              errors={errors}
              accounts={accounts}
              categories={categories}
              onSubmit={add}
              notice={notice}
              active={open}
            />
          )}

          <div
            className={cn(
              "mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-4",
              showModeLink ? "justify-between" : "justify-end",
            )}
          >
            {showModeLink &&
              (currentView === "manual" ? (
                <Button variant="ghost" onClick={goPhrase} disabled={saving}>
                  <Sparkles aria-hidden />
                  Écrire une phrase
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => goManual()} disabled={currentView === "analyzing" || saving}>
                  <PenLine aria-hidden />
                  Saisir à la main
                </Button>
              ))}
            <Button variant="ghost" onClick={onImport} disabled={saving}>
              <FileUp aria-hidden />
              Importer un relevé CSV
            </Button>
          </div>
        </>
      )}
    </Sheet>
  );
}

/**
 * Deux actions côte à côte aussi sur téléphone (action principale à droite, la plus large) :
 * le pied de la feuille reste bas quand le clavier réduit la hauteur visible.
 */
function FooterPair({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-[auto_1fr] gap-2 md:flex md:justify-end">{children}</div>;
}
