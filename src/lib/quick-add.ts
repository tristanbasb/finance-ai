// Saisie rapide d'une opération : valeurs du formulaire, validation et corps de
// `POST /api/transactions`. Module pur, sans DOM ni dépendance serveur (utilisable côté client).

import { centsToInput } from "./amount-input";
import { parseAmount } from "./money";

export type TransactionKind = "expense" | "income";

/** Proposition d'opération (réponse de `POST /api/ai/parse-transaction`, montant toujours > 0). */
export type Proposal = {
  amountCents: number;
  kind: TransactionKind;
  categoryId: number | null;
  label: string;
  date: string;
  accountId: number | null;
};

/** Valeurs brutes du formulaire (chaînes telles que saisies ; "" = vide). */
export type TransactionFormValues = {
  kind: TransactionKind;
  /** Montant saisi, sans signe (« 12,50 »). */
  amount: string;
  date: string;
  label: string;
  accountId: string;
  categoryId: string;
  note: string;
};

export type TransactionFormErrors = Partial<Record<"amount" | "date" | "label" | "account" | "note", string>>;

/** Corps attendu par `POST /api/transactions` (`transactionInput`) : montant signé, dépense < 0. */
export type TransactionBody = {
  accountId: number;
  categoryId: number | null;
  date: string;
  amount: number;
  label: string;
  note: string | null;
};

export type ValidationResult = { ok: true; body: TransactionBody } | { ok: false; errors: TransactionFormErrors };

/** Plus grand montant accepté (centimes, en valeur absolue). */
export const MAX_AMOUNT_CENTS = 9_999_999_999;
export const MAX_LABEL_LENGTH = 200;
export const MAX_NOTE_LENGTH = 1000;

type AccountLike = { id: number; type?: string; archived?: boolean };

/**
 * Compte par défaut : `preferred` s'il désigne un compte non archivé (ex. filtre de l'Activité),
 * sinon premier compte courant non archivé, sinon premier compte non archivé, sinon null.
 */
export function defaultAccountId(accounts: readonly AccountLike[], preferred?: number | null): number | null {
  const open = accounts.filter((a) => !a.archived);
  return (open.find((a) => a.id === preferred) ?? open.find((a) => a.type === "checking") ?? open[0])?.id ?? null;
}

/**
 * Première vue de la saisie rapide : la proposition si un montant est fourni, le formulaire si
 * d'autres champs le sont, sinon la phrase (IA active) ou le formulaire. Un compte seul n'est
 * qu'une valeur par défaut et ne court-circuite pas la phrase.
 */
export function initialQuickAddView(prefill: Partial<Proposal> | undefined, aiEnabled: boolean): "phrase" | "proposal" | "manual" {
  if (prefill && typeof prefill.amountCents === "number") return "proposal";
  const others = Object.entries(prefill ?? {}).some(([key, value]) => key !== "accountId" && value !== undefined);
  if (others) return "manual";
  return aiEnabled ? "phrase" : "manual";
}

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function positiveId(value: unknown): number | null {
  const n = typeof value === "string" ? (/^\d+$/.test(value) ? Number(value) : Number.NaN) : value;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null;
}

type Fields = {
  kind: TransactionKind;
  /** Montant en centimes ; `undefined` = vide, `null` = illisible. */
  cents: number | null | undefined;
  date: string;
  label: string;
  accountId: unknown;
  categoryId: unknown;
  note: string;
};

function build(f: Fields): ValidationResult {
  const errors: TransactionFormErrors = {};
  if (f.cents === undefined) errors.amount = "Saisissez un montant.";
  else if (f.cents === null) errors.amount = "Montant illisible. Exemple : 12,50.";
  else if (f.cents === 0) errors.amount = "Le montant doit être supérieur à 0.";
  else if (Math.abs(f.cents) > MAX_AMOUNT_CENTS) errors.amount = "Montant trop élevé.";
  if (!isRealDate(f.date)) errors.date = "Choisissez une date valide.";
  const label = f.label.trim();
  if (label === "") errors.label = "Saisissez un libellé.";
  else if (label.length > MAX_LABEL_LENGTH) errors.label = `${MAX_LABEL_LENGTH} caractères au maximum.`;
  const accountId = positiveId(f.accountId);
  if (accountId === null) errors.account = "Choisissez un compte.";
  const note = f.note.trim();
  if (note.length > MAX_NOTE_LENGTH) errors.note = "1 000 caractères au maximum.";

  if (Object.keys(errors).length > 0 || f.cents == null || accountId === null) return { ok: false, errors };
  const abs = Math.abs(f.cents);
  return {
    ok: true,
    body: {
      accountId,
      categoryId: positiveId(f.categoryId),
      date: f.date,
      amount: f.kind === "expense" ? -abs : abs,
      label,
      note: note === "" ? null : note,
    },
  };
}

/** Valide le formulaire et construit le corps de la requête (signe selon le sens). */
export function validateTransactionForm(values: TransactionFormValues): ValidationResult {
  return build({
    kind: values.kind,
    cents: values.amount.trim() === "" ? undefined : parseAmount(values.amount),
    date: values.date,
    label: values.label,
    accountId: values.accountId,
    categoryId: values.categoryId,
    note: values.note,
  });
}

/** Proposition (montant > 0 en centimes) → corps de `POST /api/transactions`, après validation. */
export function proposalToTransactionBody(p: Proposal & { note?: string | null }): ValidationResult {
  const cents = Number.isSafeInteger(p.amountCents) ? p.amountCents : null;
  return build({
    kind: p.kind === "income" ? "income" : "expense",
    cents,
    date: p.date,
    label: p.label ?? "",
    accountId: p.accountId,
    categoryId: p.categoryId,
    note: p.note ?? "",
  });
}

/** Valeurs du formulaire à partir d'une proposition, éventuellement partielle (champs absents → défauts). */
export function proposalToFormValues(
  p: Partial<Proposal>,
  defaults: { today: string; accountId: number | null },
): TransactionFormValues {
  const amount =
    typeof p.amountCents === "number" && Number.isSafeInteger(p.amountCents) && p.amountCents !== 0
      ? centsToInput(Math.abs(p.amountCents))
      : "";
  const accountId = positiveId(p.accountId) ?? defaults.accountId;
  const categoryId = positiveId(p.categoryId);
  return {
    kind: p.kind === "income" ? "income" : "expense",
    amount,
    date: typeof p.date === "string" && isRealDate(p.date) ? p.date : defaults.today,
    label: typeof p.label === "string" ? p.label : "",
    accountId: accountId === null ? "" : String(accountId),
    categoryId: categoryId === null ? "" : String(categoryId),
    note: "",
  };
}

/** Change le sens ; une catégorie de l'autre nature n'a plus de sens et est retirée. */
export function withKind(
  values: TransactionFormValues,
  kind: TransactionKind,
  categories: readonly { id: number; kind: TransactionKind }[],
): TransactionFormValues {
  const current = categories.find((c) => String(c.id) === values.categoryId);
  return {
    ...values,
    kind,
    categoryId: current && current.kind !== kind ? "" : values.categoryId,
  };
}

type TargetLike = { tagName?: string; isContentEditable?: boolean } | null | undefined;

/** Vrai si l'élément reçoit du texte (champ, zone de texte, liste, contenu éditable) : pas de raccourci. */
export function isTypingTarget(el: unknown): boolean {
  if (!el || typeof el !== "object") return false;
  const t = el as NonNullable<TargetLike>;
  if (t.isContentEditable) return true;
  const tag = typeof t.tagName === "string" ? t.tagName.toUpperCase() : "";
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** Raccourci « N » d'ouverture : touche n/N seule (sans modificateur ni répétition), hors saisie. */
export function isQuickAddShortcut(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  repeat: boolean;
  target: unknown;
}): boolean {
  if (e.key.toLowerCase() !== "n" || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return false;
  return !isTypingTarget(e.target);
}
