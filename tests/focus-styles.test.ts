import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css)$/.test(e.name) ? [path] : [];
  });
}

/** Chaînes littérales (guillemets simples, doubles ou gabarits sans saut de ligne). */
const STRING = /"[^"\n]*"|'[^'\n]*'|`[^`\n]*`/g;

/** Vrai si une même chaîne de classes masque le contour puis compte sur `focus-visible:outline-*`. */
function hidesFocusOutline(classes: string): boolean {
  const tokens = classes.split(/\s+/);
  return tokens.includes("outline-none") && tokens.some((t) => t.startsWith("focus-visible:outline-"));
}

describe("anneau de focus", () => {
  it("détecte le motif fautif", () => {
    expect(hidesFocusOutline("outline-none focus-visible:outline-2 focus-visible:outline-ring")).toBe(true);
    expect(hidesFocusOutline("focus-visible:outline-none focus-visible:ring-3")).toBe(false);
    expect(hidesFocusOutline("outline-none")).toBe(false);
  });

  // En Tailwind v4, `outline-none` pose `--tw-outline-style: none` : un `focus-visible:outline-2`
  // dans la même liste de classes ne dessine alors aucun contour.
  it("aucune liste de classes ne combine outline-none et focus-visible:outline-*", () => {
    const offenders = sourceFiles(SRC).flatMap((file) =>
      (readFileSync(file, "utf8").match(STRING) ?? [])
        .filter((s) => hidesFocusOutline(s.slice(1, -1)))
        .map((s) => `${file}: ${s}`),
    );
    expect(offenders).toEqual([]);
  });
});
