import { describe, expect, it } from "vitest";
import {
  botDeepLink,
  formatCountdown,
  HOUR_OPTIONS,
  hourLabel,
  numberToInput,
  parsePriceMovePct,
  parseUnusualMinEur,
} from "@/lib/settings-ui";

describe("hourLabel / HOUR_OPTIONS", () => {
  it("formate l'heure", () => {
    expect(hourLabel(8)).toBe("8 h");
    expect(HOUR_OPTIONS).toHaveLength(24);
    expect(HOUR_OPTIONS[0]).toEqual({ value: 0, label: "0 h" });
    expect(HOUR_OPTIONS[23].label).toBe("23 h");
  });
});

describe("formatCountdown", () => {
  it("affiche m:ss", () => {
    expect(formatCountdown(600_000)).toBe("10:00");
    expect(formatCountdown(61_000)).toBe("1:01");
    expect(formatCountdown(59_100)).toBe("1:00");
    expect(formatCountdown(9_000)).toBe("0:09");
  });
  it("ne descend pas sous zéro", () => {
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(-5000)).toBe("0:00");
  });
});

describe("parseUnusualMinEur", () => {
  it("accepte 0 et les décimaux (virgule ou point)", () => {
    expect(parseUnusualMinEur("0")).toBe(0);
    expect(parseUnusualMinEur(" 150 ")).toBe(150);
    expect(parseUnusualMinEur("12,5")).toBe(12.5);
    expect(parseUnusualMinEur("12.5")).toBe(12.5);
  });
  it("refuse vide, négatif et texte", () => {
    expect(parseUnusualMinEur("")).toBeNull();
    expect(parseUnusualMinEur("-1")).toBeNull();
    expect(parseUnusualMinEur("abc")).toBeNull();
  });
});

describe("parsePriceMovePct", () => {
  it("exige un nombre strictement positif", () => {
    expect(parsePriceMovePct("5")).toBe(5);
    expect(parsePriceMovePct("0,5")).toBe(0.5);
    expect(parsePriceMovePct("0")).toBeNull();
    expect(parsePriceMovePct("-3")).toBeNull();
    expect(parsePriceMovePct("")).toBeNull();
  });
});

describe("numberToInput / botDeepLink", () => {
  it("utilise la virgule décimale", () => {
    expect(numberToInput(2.5)).toBe("2,5");
    expect(numberToInput(100)).toBe("100");
  });
  it("construit le lien direct", () => {
    expect(botDeepLink("mon_bot", "123456")).toBe("https://t.me/mon_bot?start=123456");
  });
});
