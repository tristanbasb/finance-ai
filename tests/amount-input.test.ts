import { describe, expect, it } from "vitest";
import { centsToInput } from "@/lib/amount-input";
import { parseAmount } from "@/lib/money";

describe("centsToInput", () => {
  it("formate les centimes avec deux décimales", () => {
    expect(centsToInput(0)).toBe("0,00");
    expect(centsToInput(5)).toBe("0,05");
    expect(centsToInput(123456)).toBe("1234,56");
  });
  it("conserve le signe d'un montant négatif", () => {
    expect(centsToInput(-123456)).toBe("-1234,56");
    expect(centsToInput(-5)).toBe("-0,05");
  });
  it("se relit à l'identique avec parseAmount", () => {
    for (const c of [0, 1, 99, 100, 250000, -250000, -1, 999999999]) {
      expect(parseAmount(centsToInput(c))).toBe(c);
    }
  });
});
