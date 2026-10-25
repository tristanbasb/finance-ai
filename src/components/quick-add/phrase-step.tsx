"use client";

import { useEffect, useId, useRef, type FormEvent, type KeyboardEvent } from "react";
import { CircleAlert, Sparkles } from "lucide-react";
import { categoryIconComponent } from "@/components/category-icon";
import { Chip } from "@/components/ui/chip";
import { describedBy, Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { KindToggle, type AccountOption, type CategoryOption } from "@/components/transactions/transaction-fields";
import { cn } from "@/lib/cn";
import { NARROW_NBSP } from "@/lib/format";
import { MAX_LABEL_LENGTH, withKind, type TransactionFormErrors, type TransactionFormValues } from "@/lib/quick-add";

export const MAX_PHRASE_LENGTH = 500;

const EXAMPLES = ["12,50 resto midi", "Courses 64 € hier", "Salaire 2 450 €"];

export type PhraseInputProps = {
  id: string;
  text: string;
  onTextChange: (text: string) => void;
  onSubmit: () => void;
  /** Analyse en cours : le champ passe en lecture seule. */
  busy: boolean;
  error?: string | null;
  /** Vrai quand la feuille est ouverte : le champ reçoit alors le focus. */
  active: boolean;
  /** Sélectionne tout le texte au focus initial (après « Recommencer »). */
  selectOnFocus?: boolean;
};

/** Zone « Écrivez comme vous parlez… » + exemples ; Entrée analyse, Maj+Entrée va à la ligne. */
export function PhraseInput({
  id,
  text,
  onTextChange,
  onSubmit,
  busy,
  error,
  active,
  selectOnFocus = false,
}: PhraseInputProps) {
  const fieldId = useId();
  const hintId = useId();
  const ref = useRef<HTMLTextAreaElement>(null);

  // showModal() (effet du parent, exécuté après celui-ci) déplacerait le focus : on attend une image.
  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      if (selectOnFocus) el.select();
      else el.setSelectionRange(el.value.length, el.value.length);
    });
    return () => cancelAnimationFrame(frame);
  }, [active, selectOnFocus]);

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!busy) onSubmit();
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!busy) onSubmit();
  }

  function pickExample(example: string) {
    onTextChange(example);
    ref.current?.focus();
  }

  const described = [describedBy(fieldId, undefined, error), hintId].filter(Boolean).join(" ");

  return (
    <form id={id} onSubmit={submit} noValidate className="space-y-3">
      <Field id={fieldId} label={<span className="sr-only">Opération en une phrase</span>} error={error}>
        <div
          className={cn(
            "group relative rounded-2xl border border-border-strong/70 bg-surface transition-[border-color,box-shadow] duration-150",
            "focus-within:border-ring focus-within:ring-4 focus-within:ring-ring/20",
            error && "border-danger focus-within:ring-danger/20",
          )}
        >
          <Sparkles aria-hidden className="pointer-events-none absolute left-4 top-4 size-[18px] text-brand" />
          <textarea
            ref={ref}
            id={fieldId}
            rows={3}
            value={text}
            maxLength={MAX_PHRASE_LENGTH}
            readOnly={busy}
            onChange={(e) => onTextChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Écrivez comme vous parlez…"
            autoComplete="off"
            enterKeyHint="send"
            aria-invalid={error ? true : undefined}
            aria-describedby={described}
            className="block min-h-24 w-full resize-none rounded-2xl bg-transparent py-3.5 pl-11 pr-4 text-[17px] leading-snug text-fg placeholder:text-subtle focus:outline-none read-only:text-muted"
          />
        </div>
      </Field>
      <p id={hintId} className="text-[13px] text-muted">
        Montant, objet, date si besoin : Claude remplit le reste et vous vérifiez avant d&apos;ajouter.
      </p>
      <div role="group" aria-label="Exemples" className="flex flex-wrap gap-2">
        {EXAMPLES.map((example) => (
          <Chip key={example} onClick={() => pickExample(example)} disabled={busy}>
            {example}
          </Chip>
        ))}
      </div>
    </form>
  );
}

/** Squelette de la proposition pendant l'analyse. */
export function ProposalSkeleton() {
  return (
    <div aria-hidden className="mt-5 space-y-4 rounded-2xl border border-border bg-surface-2/50 p-4">
      <div className="mx-auto h-9 w-48 animate-pulse rounded-lg bg-border/80" />
      <div className="mx-auto h-11 w-36 animate-pulse rounded-lg bg-border/80" />
      <div className="flex gap-2">
        {[20, 28, 24].map((w) => (
          <div key={w} className="h-9 animate-pulse rounded-full bg-border/80" style={{ width: `${w * 4}px` }} />
        ))}
      </div>
      <div className="h-10 animate-pulse rounded-xl bg-border/80" />
    </div>
  );
}

/** Erreur d'analyse (délai dépassé, serveur…). Les actions sont dans le pied de la feuille. */
export function AnalysisError({ message, focusOnMount = false }: { message: string; focusOnMount?: boolean }) {
  const ref = useRef<HTMLParagraphElement>(null);
  // Le bouton « Analyser » a disparu : le focus passe sur le message (lu par les lecteurs d'écran).
  useEffect(() => {
    if (focusOnMount) ref.current?.focus();
  }, [focusOnMount]);
  return (
    <p
      ref={ref}
      role="alert"
      tabIndex={focusOnMount ? -1 : undefined}
      className="mt-4 flex items-start gap-2 rounded-xl bg-danger-soft px-3.5 py-2.5 text-[13px] text-fg focus:outline-none"
    >
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
      {message}
    </p>
  );
}

export type ProposalCardProps = {
  id: string;
  /** Phrase analysée, rappelée au-dessus de la proposition. */
  phrase: string;
  values: TransactionFormValues;
  onChange: (next: TransactionFormValues) => void;
  errors: TransactionFormErrors;
  accounts: AccountOption[];
  categories: CategoryOption[];
  onSubmit: () => void;
};

/** Proposition de Claude, entièrement modifiable : montant, sens, catégorie, libellé, date, compte. */
export function ProposalCard({
  id,
  phrase,
  values,
  onChange,
  errors,
  accounts,
  categories,
  onSubmit,
}: ProposalCardProps) {
  const amountId = useId();
  const categoryLabelId = useId();
  const chipsRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const set = <K extends keyof TransactionFormValues>(key: K, value: TransactionFormValues[K]) =>
    onChange({ ...values, [key]: value });

  const shown = categories.filter((c) => c.kind === values.kind);

  // À l'affichage : le focus passe sur la proposition (le champ de phrase a disparu) sans ouvrir
  // le clavier, et la catégorie proposée est ramenée dans la zone visible de la rangée défilante.
  useEffect(() => {
    formRef.current?.focus({ preventScroll: true });
    const row = chipsRef.current;
    const selected = row?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (row && selected) row.scrollLeft = selected.offsetLeft - row.offsetLeft - 20;
    // Uniquement à l'affichage de la proposition.
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit();
  }

  const expense = values.kind === "expense";

  return (
    <form
      ref={formRef}
      id={id}
      onSubmit={submit}
      noValidate
      tabIndex={-1}
      aria-label="Proposition"
      className="space-y-4 focus:outline-none"
    >
      {phrase && (
        <p className="flex items-start gap-2 text-[13px] text-muted">
          <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
          <span>
            Proposition pour <span className="font-medium text-fg">{`«${NARROW_NBSP}${phrase}${NARROW_NBSP}»`}</span>. Vérifiez,
            puis ajoutez.
          </span>
        </p>
      )}

      <div className="space-y-5 rounded-2xl border border-border bg-surface-2/50 p-4 sm:p-5">
        <KindToggle
          value={values.kind}
          onChange={(k) => onChange(withKind(values, k, categories))}
          className="mx-auto max-w-64"
        />

        <Field id={amountId} label={<span className="sr-only">Montant en euros</span>} error={errors.amount}>
          <div className="flex items-baseline justify-center gap-1.5">
            <span aria-hidden className={cn("text-3xl font-bold", expense ? "text-muted" : "text-positive")}>
              {expense ? "−" : "+"}
            </span>
            <input
              id={amountId}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0,00"
              value={values.amount}
              onChange={(e) => set("amount", e.target.value)}
              aria-invalid={errors.amount ? true : undefined}
              aria-describedby={describedBy(amountId, undefined, errors.amount)}
              // Largeur au contenu (`field-sizing`), sinon estimée en caractères.
              style={{ "--chars": Math.max(4, values.amount.length + 0.5) } as React.CSSProperties}
              className={cn(
                "num field-sizing-content w-[calc(var(--chars)*1ch)] min-w-[3ch] max-w-full rounded-lg px-1 supports-[field-sizing:content]:w-auto border-b-2 border-transparent bg-transparent text-center text-[40px] font-bold leading-tight tracking-[-0.03em] text-fg",
                "placeholder:text-subtle hover:border-border-strong focus:border-ring focus:outline-none",
                "aria-invalid:border-danger",
              )}
            />
            <span aria-hidden className="text-3xl font-bold text-muted">
              €
            </span>
          </div>
        </Field>

        <div className="space-y-2">
          <p id={categoryLabelId} className="text-[13px] font-semibold text-fg">
            Catégorie
          </p>
          <div
            ref={chipsRef}
            role="group"
            aria-labelledby={categoryLabelId}
            className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 py-1.5 [scrollbar-width:none] sm:-mx-5 sm:px-5 [&::-webkit-scrollbar]:hidden"
          >
            <Chip selected={values.categoryId === ""} onClick={() => set("categoryId", "")} className="snap-start">
              Aucune
            </Chip>
            {shown.map((c) => (
              <Chip
                key={c.id}
                tintColor={c.color}
                icon={categoryIconComponent(c.icon)}
                selected={String(c.id) === values.categoryId}
                onClick={() => set("categoryId", String(c.id))}
                className="snap-start"
              >
                {c.name}
              </Chip>
            ))}
          </div>
        </div>

        <Input
          label="Libellé"
          autoComplete="off"
          maxLength={MAX_LABEL_LENGTH}
          value={values.label}
          onChange={(e) => set("label", e.target.value)}
          error={errors.label}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Date"
            type="date"
            value={values.date}
            onChange={(e) => set("date", e.target.value)}
            error={errors.date}
          />
          <Select
            label="Compte"
            value={values.accountId}
            onChange={(e) => set("accountId", e.target.value)}
            options={accounts.map((a) => ({ value: a.id, label: a.name }))}
            placeholder={accounts.length === 0 ? "Aucun compte" : undefined}
            error={errors.account}
          />
        </div>
      </div>
    </form>
  );
}
