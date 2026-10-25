import { describe, expect, it } from "vitest";
import {
  categoryTint,
  contrastRatio,
  NEUTRAL_TINT_COLOR,
  parseHexColor,
  TINT_SURFACES,
  tintStyle,
} from "@/lib/category-tint";
import { DEFAULT_CATEGORIES } from "@/lib/db/seed";

const SCHEMES = ["light", "dark"] as const;

describe("parseHexColor", () => {
  it("lit #rrggbb et #rgb, sans tenir compte de la casse ni des espaces", () => {
    expect(parseHexColor("#4F46E5")).toEqual([0x4f, 0x46, 0xe5]);
    expect(parseHexColor(" #fff ")).toEqual([255, 255, 255]);
    expect(parseHexColor("#0a0")).toEqual([0, 0xaa, 0]);
  });

  it("refuse ce qui n'est pas une couleur hexadécimale", () => {
    for (const bad of ["", "red", "#12345", "#gggggg", "4f46e5", "#4f46e5ff", "rgb(0,0,0)"]) {
      expect(parseHexColor(bad)).toBeNull();
    }
    expect(parseHexColor(null)).toBeNull();
    expect(parseHexColor(undefined)).toBeNull();
  });
});

describe("contrastRatio", () => {
  it("vaut 21 entre blanc et noir, 1 entre deux couleurs identiques", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#4f46e5", "#4f46e5")).toBeCloseTo(1, 5);
  });

  it("correspond aux valeurs WCAG connues", () => {
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
    expect(contrastRatio("#4f46e5", "#ffffff")).toBeGreaterThan(6);
  });

  it("le texte blanc reste lisible (AA) sur les deux extrémités du dégradé de marque", () => {
    expect(contrastRatio("#ffffff", "#4f46e5")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#ffffff", "#9333ea")).toBeGreaterThanOrEqual(4.5);
  });

  it("renvoie NaN pour une couleur illisible", () => {
    expect(contrastRatio("nope", "#ffffff")).toBeNaN();
  });
});

describe("categoryTint", () => {
  for (const scheme of SCHEMES) {
    it(`garantit un texte AA sur le fond pastel de chaque catégorie par défaut (${scheme})`, () => {
      for (const { name, color } of DEFAULT_CATEGORIES) {
        const { bg, fg } = categoryTint(color, scheme);
        expect(contrastRatio(fg, bg), `${name} ${color}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`teinte le fond sans s'éloigner de la surface (${scheme})`, () => {
      const surface = TINT_SURFACES[scheme];
      for (const { color } of DEFAULT_CATEGORIES) {
        const { bg } = categoryTint(color, scheme);
        expect(bg).not.toBe(surface);
        // Pastel : reste proche de la surface (contraste faible avec elle).
        expect(contrastRatio(bg, surface)).toBeLessThan(1.6);
      }
    });

    it(`garde un texte AA pour des couleurs extrêmes (${scheme})`, () => {
      for (const color of ["#ffffff", "#000000", "#ffff00", "#0000ff", "#808080", "#fde047"]) {
        const { bg, fg } = categoryTint(color, scheme);
        expect(contrastRatio(fg, bg), color).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`retombe sur la teinte neutre pour une couleur invalide (${scheme})`, () => {
      const neutral = categoryTint(NEUTRAL_TINT_COLOR, scheme);
      expect(categoryTint("pas une couleur", scheme)).toEqual(neutral);
      expect(categoryTint(null, scheme)).toEqual(neutral);
      expect(categoryTint(undefined, scheme)).toEqual(neutral);
    });
  }

  it("renvoie des couleurs #rrggbb et un anneau distinct du fond", () => {
    const t = categoryTint("#22c55e", "light");
    for (const v of [t.bg, t.fg, t.ring]) expect(v).toMatch(/^#[0-9a-f]{6}$/);
    expect(t.ring).not.toBe(t.bg);
  });

  it("assombrit le texte en clair et l'éclaircit en sombre", () => {
    const light = categoryTint("#22c55e", "light");
    const dark = categoryTint("#22c55e", "dark");
    expect(contrastRatio(light.fg, "#000000")).toBeLessThan(contrastRatio("#22c55e", "#000000"));
    expect(contrastRatio(dark.fg, "#ffffff")).toBeLessThanOrEqual(contrastRatio("#22c55e", "#ffffff"));
  });

  it("est insensible à la casse et accepte #rgb", () => {
    expect(categoryTint("#22C55E", "light")).toEqual(categoryTint("#22c55e", "light"));
    expect(categoryTint("#fff", "dark")).toEqual(categoryTint("#ffffff", "dark"));
  });
});

describe("tintStyle", () => {
  it("expose les paires clair et sombre en variables CSS", () => {
    const style = tintStyle("#3b82f6");
    const light = categoryTint("#3b82f6", "light");
    const dark = categoryTint("#3b82f6", "dark");
    expect(style).toEqual({
      "--tint-bg-light": light.bg,
      "--tint-fg-light": light.fg,
      "--tint-ring-light": light.ring,
      "--tint-bg-dark": dark.bg,
      "--tint-fg-dark": dark.fg,
      "--tint-ring-dark": dark.ring,
    });
  });
});
