/**
 * Teintes pastel des catégories : à partir de la couleur d'une catégorie, calcule un fond
 * pastel (mélange avec la surface), un texte lisible (contraste WCAG AA ≥ 4,5:1 garanti
 * contre ce fond) et une couleur d'anneau/bordure. Fonctions pures, sans DOM.
 */

export type ColorScheme = "light" | "dark";
export type Rgb = readonly [number, number, number];
export type CategoryTint = { bg: string; fg: string; ring: string };

/** Couleur utilisée quand celle de la catégorie est absente ou invalide (ardoise). */
export const NEUTRAL_TINT_COLOR = "#94a3b8";

/** Surfaces des cartes (doivent suivre `--surface` dans globals.css). */
export const TINT_SURFACES: Record<ColorScheme, string> = {
  light: "#ffffff",
  dark: "#181a33",
};

/** Part de la couleur dans le fond pastel, et dans l'anneau. */
const BG_AMOUNT: Record<ColorScheme, number> = { light: 0.15, dark: 0.2 };
const RING_AMOUNT: Record<ColorScheme, number> = { light: 0.4, dark: 0.45 };
/** Mélange de départ du texte vers le noir (clair) ou le blanc (sombre) : ton profond. */
const FG_START = 0.45;
const AA = 4.5;

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `#rgb` / `#rrggbb` → [r, g, b] (0–255) ; `null` si la chaîne n'est pas une couleur hex. */
export function parseHexColor(value: string | null | undefined): Rgb | null {
  if (typeof value !== "string") return null;
  const m = HEX.exec(value.trim());
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c);
  const n = Number.parseInt(hex, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

export function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;
}

/** Mélange linéaire (sRGB, comme `color-mix(in srgb …)`) : `amount` de `a`, le reste de `b`. */
export function mixRgb(a: Rgb, b: Rgb, amount: number): Rgb {
  return [0, 1, 2].map((i) => Math.round(a[i] * amount + b[i] * (1 - amount))) as unknown as Rgb;
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Luminance relative WCAG 2.x. */
export function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Rapport de contraste WCAG entre deux couleurs hex (1 à 21) ; `NaN` si l'une est invalide. */
export function contrastRatio(a: string, b: string): number {
  const ra = parseHexColor(a);
  const rb = parseHexColor(b);
  return ra && rb ? ratio(ra, rb) : Number.NaN;
}

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

/**
 * Teinte d'une catégorie pour un schéma de couleurs : fond pastel, texte AA, anneau.
 * Une couleur invalide ou absente donne la teinte neutre.
 */
export function categoryTint(color: string | null | undefined, scheme: ColorScheme): CategoryTint {
  const base = parseHexColor(color) ?? (parseHexColor(NEUTRAL_TINT_COLOR) as Rgb);
  const surface = parseHexColor(TINT_SURFACES[scheme]) as Rgb;
  const bg = mixRgb(base, surface, BG_AMOUNT[scheme]);
  const ring = mixRgb(base, surface, RING_AMOUNT[scheme]);

  // Texte : la couleur assombrie (clair) ou éclaircie (sombre) jusqu'à atteindre AA.
  const target = scheme === "light" ? BLACK : WHITE;
  let fg = mixRgb(base, target, 1 - FG_START);
  for (let t = FG_START; ratio(fg, bg) < AA && t < 1; ) {
    t = Math.min(1, t + 0.05);
    fg = mixRgb(base, target, 1 - t);
  }
  return { bg: toHex(bg), fg: toHex(fg), ring: toHex(ring) };
}

/**
 * Variables CSS lues par l'utilitaire `tint` (globals.css) : les deux paires clair/sombre
 * sont posées, la feuille de style choisit selon `prefers-color-scheme`.
 * À utiliser avec `className="tint"` et `style={tintStyle(color)}`.
 */
export function tintStyle(color: string | null | undefined): Record<string, string> {
  const light = categoryTint(color, "light");
  const dark = categoryTint(color, "dark");
  return {
    "--tint-bg-light": light.bg,
    "--tint-fg-light": light.fg,
    "--tint-ring-light": light.ring,
    "--tint-bg-dark": dark.bg,
    "--tint-fg-dark": dark.fg,
    "--tint-ring-dark": dark.ring,
  };
}
