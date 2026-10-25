import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return tsxFiles(path);
    return e.name.endsWith(".tsx") ? [path] : [];
  });
}

const css = readFileSync(join(SRC, "app/globals.css"), "utf8");
const lines = tsxFiles(SRC).flatMap((file) =>
  readFileSync(file, "utf8")
    .split("\n")
    .map((line, i) => ({ where: `${relative(ROOT, file)}:${i + 1}`, line })),
);

/**
 * Éléments collants sous les en-têtes : sur téléphone sous l'en-tête mobile, à partir de 768 px
 * sous l'en-tête de contenu (cloche, « Afficher Claude »), qu'ils ne doivent jamais recouvrir.
 */
describe("décalages des éléments collants", () => {
  it("globals.css déclare les deux hauteurs d'en-tête", () => {
    expect(css).toMatch(/--mobile-header-h:/);
    expect(css).toMatch(/--content-header-h:\s*4rem;/);
  });

  it("l'en-tête de contenu a la hauteur déclarée", () => {
    const shell = readFileSync(join(SRC, "components/shell/app-shell.tsx"), "utf8");
    expect(shell).toContain("h-(--content-header-h)");
  });

  it("tout élément collant sous l'en-tête mobile se place sous l'en-tête de contenu à partir de md", () => {
    const offenders = lines
      .filter(({ line }) => /\bsticky\b/.test(line) && line.includes("top-[var(--mobile-header-h)]"))
      .filter(({ line }) => !line.includes("md:top-[var(--content-header-h)]"))
      .map(({ where }) => where);
    expect(offenders).toEqual([]);
  });

  it("les ancres de rubrique dégagent en-tête et sommaire (scroll-mt-section)", () => {
    expect(css).toMatch(/@utility scroll-mt-section/);
    const offenders = lines.filter(({ line }) => /\bscroll-mt-32\b/.test(line)).map(({ where }) => where);
    expect(offenders).toEqual([]);
  });
});
