import { describe, expect, it } from "vitest";
import {
  formatDateFull,
  formatDateLong,
  formatDateShort,
  formatEURCompact,
  formatMonth,
  formatPercent,
} from "@/lib/format";
import { splitEUR } from "@/components/amount";

// Intl insère des espaces insécables : on les normalise pour comparer.
const norm = (s: string) => s.replace(/\s/g, " ");

describe("format", () => {
  it("formate les pourcentages à la française", () => {
    expect(norm(formatPercent(0.125))).toBe("12,5 %");
    expect(norm(formatPercent(0))).toBe("0 %");
  });

  it("compacte les montants d'axe", () => {
    expect(norm(formatEURCompact(95_000))).toBe("950 €");
    expect(norm(formatEURCompact(1_240_000))).toBe("12,4 k€");
    expect(norm(formatEURCompact(123_456_700))).toBe("1,2 M€");
  });

  it("formate les dates sans décalage de fuseau", () => {
    expect(formatDateShort("2026-10-01")).toBe("1 oct.");
    expect(formatDateLong("2026-10-24")).toBe("samedi 24 octobre");
    expect(formatDateFull("2026-01-31")).toBe("31 janvier 2026");
    expect(formatMonth("2026-10")).toBe("octobre 2026");
    expect(formatMonth("2026-02-15")).toBe("février 2026");
  });

  it("sépare la partie entière et les centimes", () => {
    const { whole, rest } = splitEUR(1_234_567);
    expect(norm(whole)).toBe("12 345");
    expect(norm(rest)).toBe(",67 €");
  });
});
