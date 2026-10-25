import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Aucun test ne doit toucher ./data : la base du singleton getDb() est en mémoire.
    env: { DATABASE_PATH: ":memory:" },
  },
});
