import { describe, expect, it } from "vitest";
import { netWorthVariation, sparkline, variationAmount, variationLabel } from "@/lib/home";

const norm = (s: string) => s.replace(/\s/g, " ");

describe("netWorthVariation", () => {
  it("vaut null sous deux instantanés", () => {
    expect(netWorthVariation([])).toBeNull();
    expect(netWorthVariation([{ date: "2026-10-01", netWorth: 100 }])).toBeNull();
  });

  it("compare le dernier instantané au premier", () => {
    expect(
      netWorthVariation([
        { date: "2026-07-27", netWorth: 1_000_00 },
        { date: "2026-09-01", netWorth: 500_00 },
        { date: "2026-10-25", netWorth: 2_836_00 },
      ]),
    ).toEqual({ change: 1_836_00, since: "2026-07-27" });
  });
});

describe("variationLabel", () => {
  it("signe le montant et donne la date de départ", () => {
    expect(norm(variationLabel({ change: 1_836_00, since: "2026-07-27" }))).toBe("+ 1 836,00 € depuis le 27 juil.");
    expect(norm(variationLabel({ change: -250_00, since: "2026-10-01" }))).toBe("− 250,00 € depuis le 1 oct.");
  });

  it("dit « Stable » sans écart", () => {
    expect(variationLabel({ change: 0, since: "2026-10-01" })).toBe("Stable depuis le 1 oct.");
    expect(norm(variationAmount(0))).toBe("0,00 €");
  });
});

describe("sparkline", () => {
  it("vaut null sous deux valeurs", () => {
    expect(sparkline([], 100, 40)).toBeNull();
    expect(sparkline([5], 100, 40)).toBeNull();
  });

  it("répartit les points sur la largeur, minimum en bas, maximum en haut", () => {
    const s = sparkline([0, 10, 5], 100, 40, 2)!;
    expect(s.line).toBe("M0 38 L50 2 L100 20");
    expect(s.area).toBe("M0 38 L50 2 L100 20 L100 40 L0 40 Z");
    expect(s.last).toEqual({ x: 100, y: 20 });
  });

  it("trace une série constante au milieu", () => {
    expect(sparkline([7, 7], 60, 30)!.line).toBe("M0 15 L60 15");
  });
});
