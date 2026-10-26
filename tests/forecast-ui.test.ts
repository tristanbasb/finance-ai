import { describe, expect, it } from "vitest";
import {
  affordMessage,
  outOfForecastHint,
  parsePositiveAmount,
  RECURRING_STATUS_LABELS,
} from "@/lib/forecast-ui";
import { formatEUR, MAX_CENTS } from "@/lib/money";

describe("affordMessage", () => {
  it("oui : reste et marge respectée (texte exact de la spec)", () => {
    expect(affordMessage({ ok: true, remaining: 35000, missing: 0 }, 20000)).toEqual({
      tone: "ok",
      text: `Oui, il vous resterait ${formatEUR(35000)} (marge de ${formatEUR(20000)} respectée)`,
    });
  });

  it("non : montant manquant pour garder la marge (texte exact de la spec)", () => {
    expect(affordMessage({ ok: false, remaining: 5000, missing: 15000 }, 20000)).toEqual({
      tone: "ko",
      text: `Il manquerait ${formatEUR(15000)} pour garder votre marge de ${formatEUR(20000)}`,
    });
  });

  it("marge 0 : pas de mention d'une marge nulle", () => {
    expect(affordMessage({ ok: true, remaining: 0, missing: 0 }, 0)).toEqual({
      tone: "ok",
      text: `Oui, il vous resterait ${formatEUR(0)}`,
    });
    expect(affordMessage({ ok: false, remaining: -1250, missing: 1250 }, 0)).toEqual({
      tone: "ko",
      text: `Il manquerait ${formatEUR(1250)} pour finir le mois sans découvert`,
    });
  });
});

describe("parsePositiveAmount", () => {
  it("lit un montant à la française avec séparateur de milliers", () => {
    expect(parsePositiveAmount("1 234,56")).toEqual({ ok: true, cents: 123456 });
    expect(parsePositiveAmount(" 49,9 € ")).toEqual({ ok: true, cents: 4990 });
  });

  it("vide : demande un montant", () => {
    expect(parsePositiveAmount("")).toEqual({ ok: false, error: "Indiquez un montant." });
    expect(parsePositiveAmount("   ")).toEqual({ ok: false, error: "Indiquez un montant." });
  });

  it("négatif ou nul : refusé", () => {
    expect(parsePositiveAmount("-12")).toEqual({ ok: false, error: "Le montant doit être supérieur à zéro." });
    expect(parsePositiveAmount("0")).toEqual({ ok: false, error: "Le montant doit être supérieur à zéro." });
    expect(parsePositiveAmount("0,001")).toEqual({ ok: false, error: "Le montant doit être supérieur à zéro." });
  });

  it("illisible ou trop élevé : refusé", () => {
    expect(parsePositiveAmount("douze")).toEqual({ ok: false, error: "Montant illisible. Exemple : 49,90." });
    expect(parsePositiveAmount(String(MAX_CENTS))).toEqual({ ok: false, error: "Montant trop élevé." });
    expect(parsePositiveAmount("999999999,99")).toEqual({ ok: true, cents: MAX_CENTS });
  });
});

describe("RECURRING_STATUS_LABELS / outOfForecastHint", () => {
  it("libellés des statuts", () => {
    expect(RECURRING_STATUS_LABELS).toEqual({ due: "À payer", paid: "Payée", skipped: "Passée" });
  });

  it("raison de l'exclusion de la prévision", () => {
    expect(outOfForecastHint({ type: "savings", archived: false })).toBe("Hors prévision (compte d'épargne)");
    expect(outOfForecastHint({ type: "checking", archived: true })).toBe("Hors prévision (compte archivé)");
    expect(outOfForecastHint({ type: "investment", archived: false })).toBe("Hors prévision (pas un compte courant)");
    expect(outOfForecastHint(undefined)).toBe("Hors prévision (pas un compte courant)");
  });
});
