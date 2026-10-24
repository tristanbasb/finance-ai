import { describe, expect, it } from "vitest";
import { formatEUR, fromCents, parseAmount, parseDate, toCents } from "@/lib/money";

describe("parseAmount", () => {
  it("parse le format français avec espaces et symbole euro", () => {
    expect(parseAmount("-1 234,56 €")).toBe(-123456);
  });
  it("parse le format anglais (point décimal, virgule milliers)", () => {
    expect(parseAmount("1,234.56")).toBe(123456);
  });
  it("parse un entier", () => {
    expect(parseAmount("12")).toBe(1200);
  });
  it("accepte le signe + et une virgule décimale seule", () => {
    expect(parseAmount("+3,5")).toBe(350);
  });
  it("retourne null pour une valeur non numérique", () => {
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("   ")).toBeNull();
    expect(parseAmount("1,2,3,x")).toBeNull();
  });
  it("gère les espaces insécables (NBSP et fine)", () => {
    expect(parseAmount("1 000,00")).toBe(100000);
    expect(parseAmount("1 000,00")).toBe(100000);
  });
  it("retire EUR et gère le signe final", () => {
    expect(parseAmount("12,50 EUR")).toBe(1250);
    expect(parseAmount("12,50-")).toBe(-1250);
  });
  it("le dernier séparateur est le séparateur décimal quand les deux apparaissent", () => {
    expect(parseAmount("1.234,56")).toBe(123456);
    expect(parseAmount("1.234.567,89")).toBe(123456789);
  });
  it("traite un point seul suivi de 3 chiffres comme décimal, sauf groupes multiples", () => {
    expect(parseAmount("1.234")).toBe(123);
    expect(parseAmount("1.234.567")).toBe(123456700);
  });
  it("arrondit au centime le plus proche", () => {
    expect(parseAmount("1,005")).toBe(101);
    expect(parseAmount("0,994")).toBe(99);
  });
});

describe("parseDate", () => {
  it("accepte DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY et YYYY-MM-DD", () => {
    expect(parseDate("24/10/2026")).toBe("2026-10-24");
    expect(parseDate("24-10-2026")).toBe("2026-10-24");
    expect(parseDate("24.10.2026")).toBe("2026-10-24");
    expect(parseDate("2026-10-24")).toBe("2026-10-24");
  });
  it("interprète YY comme 20YY", () => {
    expect(parseDate("24/10/26")).toBe("2026-10-24");
  });
  it("accepte jour/mois sur un seul chiffre", () => {
    expect(parseDate("1/2/2026")).toBe("2026-02-01");
  });
  it("rejette les dates inexistantes ou illisibles", () => {
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseDate("29/02/2026")).toBeNull();
    expect(parseDate("29/02/2028")).toBe("2028-02-29");
    expect(parseDate("pas une date")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
});

describe("formatEUR", () => {
  const norm = (s: string) => s.replace(/[  ]/g, " ");
  it("formate en euros à la française", () => {
    const out = norm(formatEUR(-123456));
    expect(out).toContain("1 234,56");
    expect(out).toContain("€");
  });
});

describe("toCents / fromCents", () => {
  it("convertit euros <-> centimes en arrondissant", () => {
    expect(toCents(12.34)).toBe(1234);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(fromCents(1234)).toBe(12.34);
  });
});
