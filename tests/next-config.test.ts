import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

async function loadConfig() {
  vi.resetModules();
  return (await import("../next.config")).default;
}

describe("next.config", () => {
  afterEach(() => {
    delete process.env.FINANCE_AI_SKIP_TYPECHECK;
  });

  it("n'écrit pas le cache Turbopack au build (jamais réutilisé dans Docker)", async () => {
    const config = await loadConfig();
    expect(config.experimental?.turbopackFileSystemCacheForBuild).toBe(false);
  });

  it("garde la vérification TypeScript par défaut", async () => {
    const config = await loadConfig();
    expect(config.typescript?.ignoreBuildErrors).toBe(false);
  });

  it("saute la vérification TypeScript quand FINANCE_AI_SKIP_TYPECHECK=1", async () => {
    process.env.FINANCE_AI_SKIP_TYPECHECK = "1";
    const config = await loadConfig();
    expect(config.typescript?.ignoreBuildErrors).toBe(true);
  });

  it("l'étape de build Docker active ce saut (la CI vérifie les types)", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    const buildStage = dockerfile.slice(dockerfile.indexOf("AS build"), dockerfile.indexOf("AS runtime"));
    expect(buildStage).toMatch(/FINANCE_AI_SKIP_TYPECHECK=1/);
  });
});
