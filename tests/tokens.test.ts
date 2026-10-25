import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/category-tint";

/**
 * Contraintes AA sur les jetons de globals.css : les valeurs hex sont lues directement
 * dans la feuille de style (bloc `:root` clair puis surcharge sombre).
 */
const css = readFileSync(join(__dirname, "../src/app/globals.css"), "utf8");

function block(source: string, start: number): string {
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error("bloc non fermé");
}

function vars(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const light = vars(block(css, css.indexOf(":root {")));
const darkMedia = css.indexOf("@media (prefers-color-scheme: dark)");
const dark = { ...light, ...vars(block(block(css, darkMedia), 0)) };

function resolve(tokens: Record<string, string>, name: string): string {
  let value = tokens[name];
  for (let i = 0; i < 5 && value?.startsWith("var("); i++) {
    value = tokens[value.slice(6, -1).trim()];
  }
  if (!value || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`--${name} non résolu : ${value}`);
  return value;
}

const SCHEMES = { light, dark } as const;

/** [texte, fonds sur lesquels il doit rester AA]. */
const PAIRS: [string, string[]][] = [
  ["text", ["bg", "surface", "surface-2"]],
  ["muted", ["bg", "surface", "surface-2"]],
  ["fg-subtle", ["bg", "surface"]],
  ["positive", ["bg", "surface", "positive-soft"]],
  ["negative", ["bg", "surface", "negative-soft"]],
  ["warning", ["bg", "surface", "warning-soft"]],
  ["brand", ["surface", "brand-soft"]],
];

describe("jetons de couleur (globals.css)", () => {
  it("lit les deux schémas", () => {
    expect(resolve(light, "surface")).toBe("#ffffff");
    expect(resolve(dark, "surface")).toBe("#181a33");
    expect(resolve(dark, "bg")).toBe("#0f1023");
  });

  for (const [scheme, tokens] of Object.entries(SCHEMES)) {
    for (const [fg, bgs] of PAIRS) {
      for (const bg of bgs) {
        it(`--${fg} sur --${bg} ≥ 4,5:1 (${scheme})`, () => {
          expect(contrastRatio(resolve(tokens, fg), resolve(tokens, bg))).toBeGreaterThanOrEqual(4.5);
        });
      }
    }

    it(`--fg-subtle reste plus discret que --muted (${scheme})`, () => {
      const surface = resolve(tokens, "surface");
      expect(contrastRatio(resolve(tokens, "fg-subtle"), surface)).toBeLessThan(
        contrastRatio(resolve(tokens, "muted"), surface) - 1,
      );
    });

    it(`texte blanc ≥ 4,5:1 sur les deux extrémités du dégradé (${scheme})`, () => {
      for (const end of ["brand-from", "brand-to"]) {
        expect(contrastRatio("#ffffff", resolve(tokens, end))).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});

describe("Chip teintée", () => {
  it("n'applique aucun filtre au survol (le texte garde son contraste AA)", async () => {
    const { chipClasses } = await import("@/components/ui/chip");
    for (const selected of [false, true]) {
      expect(chipClasses({ tinted: true, selected })).not.toMatch(/hover:\S*(brightness|opacity|contrast)/);
    }
  });
});

describe("texte blanc sur la carte héros Patrimoine", () => {
  // Calque sombre bg-black/15 (pastilles) sur les extrémités du dégradé, halos blancs inclus.
  const mix = (hex: string, over: string, a: number) => {
    const p = (h: string) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
    const [x, y] = [p(hex), p(over)];
    return "#" + x.map((v, i) => Math.round(v * (1 - a) + y[i] * a).toString(16).padStart(2, "0")).join("");
  };
  // Opacités des deux halos, lues dans le composant partagé par les cartes héros.
  const halos = readFileSync(join(__dirname, "../src/components/ui/hero-halos.tsx"), "utf8");
  const HALOS = [...halos.matchAll(/bg-white\/\[(0\.\d+)\]/g)].map((m) => Number(m[1]));
  it("lit les deux halos", () => expect(HALOS).toHaveLength(2));
  for (const end of ["brand-from", "brand-to"]) {
    it(`blanc plein lisible sur ${end}, avec halo et pastille sombre`, () => {
      const base = resolve(light, end);
      expect(contrastRatio("#ffffff", base)).toBeGreaterThanOrEqual(4.5);
      const haloPill = mix(mix(base, "#ffffff", HALOS[0]), "#000000", 0.15);
      expect(contrastRatio("#ffffff", haloPill)).toBeGreaterThanOrEqual(4.5);
    });
    it(`blanc plein lisible sur ${end} là où les deux halos se chevauchent, sans pastille`, () => {
      const both = HALOS.reduce((color, alpha) => mix(color, "#ffffff", alpha), resolve(light, end));
      expect(contrastRatio("#ffffff", both)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
