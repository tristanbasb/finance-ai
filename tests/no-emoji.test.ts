import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css)$/.test(e.name) ? [path] : [];
  });
}

/**
 * Pictogrammes (emoji et symboles assimilés), sélecteurs de variation et jointure
 * sans chasse (séquences d'emoji composés). Règle du projet : aucun emoji, nulle part.
 */
const PICTOGRAPH = /[\p{Extended_Pictographic}︎️‍]/u;

describe("aucun emoji dans le code", () => {
  it("détecte les pictogrammes", () => {
    expect(PICTOGRAPH.test("Alerte : budget dépassé")).toBe(false);
    expect(PICTOGRAPH.test("« Bilan » — 1 234,56 €")).toBe(false);
    expect(PICTOGRAPH.test("\u{1F514} Alerte")).toBe(true);
    expect(PICTOGRAPH.test("❤️")).toBe(true);
    expect(PICTOGRAPH.test("✅")).toBe(true);
  });

  it("aucun fichier de src/ ne contient de pictogramme", () => {
    const offenders = sourceFiles(SRC).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, i) => (PICTOGRAPH.test(line) ? [`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`] : [])),
    );
    expect(offenders).toEqual([]);
  });
});
