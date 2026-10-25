import { describe, expect, it } from "vitest";
import {
  defaultAccountId,
  isQuickAddShortcut,
  isTypingTarget,
  proposalToFormValues,
  proposalToTransactionBody,
  validateTransactionForm,
  withKind,
  type Proposal,
  type TransactionFormValues,
} from "@/lib/quick-add";
import { transactionInput } from "@/lib/validation";

const proposal: Proposal = {
  amountCents: 1250,
  kind: "expense",
  categoryId: 3,
  label: "Resto midi avec Paul",
  date: "2026-10-25",
  accountId: 1,
};

const form: TransactionFormValues = {
  kind: "expense",
  amount: "12,50",
  date: "2026-10-25",
  label: "Resto midi",
  accountId: "1",
  categoryId: "3",
  note: "",
};

describe("proposalToTransactionBody", () => {
  it("rend le montant négatif pour une dépense et conforme à transactionInput", () => {
    const r = proposalToTransactionBody(proposal);
    expect(r).toEqual({
      ok: true,
      body: {
        accountId: 1,
        categoryId: 3,
        date: "2026-10-25",
        amount: -1250,
        label: "Resto midi avec Paul",
        note: null,
      },
    });
    if (r.ok) expect(transactionInput.safeParse(r.body).success).toBe(true);
  });

  it("garde un montant positif pour un revenu", () => {
    const r = proposalToTransactionBody({
      ...proposal,
      kind: "income",
      amountCents: 245000,
      categoryId: null,
    });
    expect(r.ok && r.body.amount).toBe(245000);
    expect(r.ok && r.body.categoryId).toBeNull();
  });

  it("refuse montant nul, non entier ou trop élevé, date inexistante, libellé vide et compte absent", () => {
    const r = proposalToTransactionBody({
      ...proposal,
      amountCents: 0,
      date: "2026-02-30",
      label: "   ",
      accountId: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["account", "amount", "date", "label"]);
    expect(proposalToTransactionBody({ ...proposal, amountCents: 12.5 }).ok).toBe(false);
    expect(proposalToTransactionBody({ ...proposal, amountCents: 10_000_000_000 }).ok).toBe(false);
  });

  it("taille le libellé et ajoute la note éventuelle", () => {
    const r = proposalToTransactionBody({
      ...proposal,
      label: "  Café  ",
      note: "  avec Léa ",
    });
    expect(r.ok && r.body.label).toBe("Café");
    expect(r.ok && r.body.note).toBe("avec Léa");
  });
});

describe("validateTransactionForm", () => {
  it("lit le montant à la française et signe selon le sens", () => {
    expect(validateTransactionForm(form)).toMatchObject({
      ok: true,
      body: { amount: -1250, accountId: 1, categoryId: 3 },
    });
    expect(validateTransactionForm({ ...form, kind: "income", amount: "2 450 €" })).toMatchObject({
      ok: true,
      body: { amount: 245000 },
    });
    // Un signe saisi ne change pas le sens choisi.
    expect(validateTransactionForm({ ...form, amount: "-12,50" })).toMatchObject({ ok: true, body: { amount: -1250 } });
  });

  it("catégorie vide → null", () => {
    expect(validateTransactionForm({ ...form, categoryId: "" })).toMatchObject({
      ok: true,
      body: { categoryId: null },
    });
  });

  it("donne un message par champ invalide", () => {
    expect(validateTransactionForm({ ...form, amount: "" })).toEqual({
      ok: false,
      errors: { amount: "Saisissez un montant." },
    });
    expect(validateTransactionForm({ ...form, amount: "douze" })).toMatchObject({
      ok: false,
      errors: { amount: "Montant illisible. Exemple : 12,50." },
    });
    expect(validateTransactionForm({ ...form, amount: "0" })).toMatchObject({
      errors: { amount: "Le montant doit être supérieur à 0." },
    });
    expect(validateTransactionForm({ ...form, label: "x".repeat(201) })).toMatchObject({
      errors: { label: "200 caractères au maximum." },
    });
    expect(validateTransactionForm({ ...form, accountId: "" })).toMatchObject({
      errors: { account: "Choisissez un compte." },
    });
    expect(validateTransactionForm({ ...form, note: "n".repeat(1001) })).toMatchObject({
      errors: { note: "1 000 caractères au maximum." },
    });
    expect(validateTransactionForm({ ...form, date: "25/10/2026" })).toMatchObject({
      errors: { date: "Choisissez une date valide." },
    });
  });
});

describe("proposalToFormValues", () => {
  const defaults = { today: "2026-10-25", accountId: 7 };

  it("convertit une proposition complète", () => {
    expect(proposalToFormValues(proposal, defaults)).toEqual({
      kind: "expense",
      amount: "12,50",
      date: "2026-10-25",
      label: "Resto midi avec Paul",
      accountId: "1",
      categoryId: "3",
      note: "",
    });
  });

  it("complète une proposition partielle (sans montant) avec les valeurs par défaut", () => {
    expect(proposalToFormValues({ kind: "income", label: "Salaire", date: "pas une date" }, defaults)).toEqual({
      kind: "income",
      amount: "",
      date: "2026-10-25",
      label: "Salaire",
      accountId: "7",
      categoryId: "",
      note: "",
    });
    expect(proposalToFormValues({}, { today: "2026-10-25", accountId: null }).accountId).toBe("");
  });

  it("aller-retour : la proposition revalidée redonne le même corps", () => {
    const values = proposalToFormValues(proposal, defaults);
    expect(validateTransactionForm(values)).toEqual(proposalToTransactionBody(proposal));
  });
});

describe("withKind", () => {
  const categories = [
    { id: 3, kind: "expense" as const },
    { id: 9, kind: "income" as const },
  ];
  it("retire une catégorie de l'autre nature et garde une catégorie compatible", () => {
    expect(withKind(form, "income", categories)).toMatchObject({
      kind: "income",
      categoryId: "",
    });
    expect(withKind({ ...form, categoryId: "9", kind: "income" }, "income", categories).categoryId).toBe("9");
    expect(withKind({ ...form, categoryId: "" }, "income", categories).categoryId).toBe("");
  });
});

describe("defaultAccountId", () => {
  it("préfère le premier compte courant non archivé", () => {
    expect(
      defaultAccountId([
        { id: 1, type: "savings" },
        { id: 2, type: "checking", archived: true },
        { id: 3, type: "checking" },
      ]),
    ).toBe(3);
    expect(defaultAccountId([{ id: 4, type: "savings" }])).toBe(4);
    expect(defaultAccountId([{ id: 5, type: "checking", archived: true }])).toBeNull();
  });
});

describe("isTypingTarget / isQuickAddShortcut", () => {
  it("reconnaît les champs de saisie et le contenu éditable", () => {
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTypingTarget({ tagName: "textarea" })).toBe(true);
    expect(isTypingTarget({ tagName: "SELECT" })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
  });

  const key = {
    key: "n",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    repeat: false,
    target: { tagName: "BODY" },
  };
  it("N seul hors champ ouvre ; modificateur, répétition, autre touche ou champ non", () => {
    expect(isQuickAddShortcut(key)).toBe(true);
    expect(isQuickAddShortcut({ ...key, key: "N" })).toBe(true);
    expect(isQuickAddShortcut({ ...key, ctrlKey: true })).toBe(false);
    expect(isQuickAddShortcut({ ...key, metaKey: true })).toBe(false);
    expect(isQuickAddShortcut({ ...key, altKey: true })).toBe(false);
    expect(isQuickAddShortcut({ ...key, repeat: true })).toBe(false);
    expect(isQuickAddShortcut({ ...key, key: "m" })).toBe(false);
    expect(isQuickAddShortcut({ ...key, target: { tagName: "INPUT" } })).toBe(false);
  });
});
