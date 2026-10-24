import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  createSession,
  isSessionSecretConfigured,
  shouldUseSecureCookie,
  verifySession,
} from "@/lib/auth/session";
import { clientKey, createRateLimiter } from "@/lib/auth/rate-limit";
import { isPublicPath } from "@/lib/auth/public-paths";
import { safeNext } from "@/lib/auth/safe-next";

describe("password", () => {
  it("hache puis vérifie le bon mot de passe", async () => {
    const stored = await hashPassword("correct horse");
    expect(await verifyPassword("correct horse", stored)).toBe(true);
  });

  it("refuse un mauvais mot de passe", async () => {
    const stored = await hashPassword("correct horse");
    expect(await verifyPassword("wrong", stored)).toBe(false);
  });

  it("produit un hash sans le caractère $", async () => {
    const stored = await hashPassword("pa$$word");
    expect(stored).not.toContain("$");
    expect(stored.startsWith("scrypt:")).toBe(true);
  });

  it("utilise un sel aléatoire", async () => {
    expect(await hashPassword("x")).not.toBe(await hashPassword("x"));
  });

  it("retourne false (sans lever) pour un hash mal formé", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "bcrypt:aa:bb")).toBe(false);
    expect(await verifyPassword("x", "scrypt:zz:yy")).toBe(false);
    expect(await verifyPassword("x", "scrypt:aabb")).toBe(false);
  });

  it("accepte les hashs produits par scripts/hash-password.mjs", async () => {
    const out = execFileSync("node", ["scripts/hash-password.mjs"], {
      input: "mon mot de passe\n",
      encoding: "utf8",
    }).trim();
    expect(out).not.toContain("$");
    expect(await verifyPassword("mon mot de passe", out)).toBe(true);
    expect(await verifyPassword("autre", out)).toBe(false);
  });
});

describe("session", () => {
  beforeAll(() => {
    process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-123";
  });

  it("accepte un jeton valide", async () => {
    const token = await createSession();
    expect(await verifySession(token)).toBe(true);
  });

  it("refuse un jeton altéré", async () => {
    const token = await createSession();
    const tampered = token.slice(0, -2) + (token.endsWith("AA") ? "BB" : "AA");
    expect(await verifySession(tampered)).toBe(false);
  });

  it("refuse un jeton absent ou invalide", async () => {
    expect(await verifySession(undefined)).toBe(false);
    expect(await verifySession("")).toBe(false);
    expect(await verifySession("n'importe quoi")).toBe(false);
  });

  it("refuse un jeton signé avec un autre secret", async () => {
    const token = await createSession();
    process.env.SESSION_SECRET = "another-secret-another-secret-another-1";
    expect(await verifySession(token)).toBe(false);
    process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-123";
  });

  it("traite un SESSION_SECRET de moins de 32 caractères comme absent", async () => {
    const token = await createSession();
    const saved = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "court-court-court";
    expect(isSessionSecretConfigured()).toBe(false);
    expect(await verifySession(token)).toBe(false);
    await expect(createSession()).rejects.toThrow();
    process.env.SESSION_SECRET = "x".repeat(32);
    expect(isSessionSecretConfigured()).toBe(true);
    process.env.SESSION_SECRET = saved;
  });

  it("refuse tout si SESSION_SECRET est absent", async () => {
    const token = await createSession();
    const saved = process.env.SESSION_SECRET;
    delete process.env.SESSION_SECRET;
    expect(await verifySession(token)).toBe(false);
    process.env.SESSION_SECRET = saved;
  });
});

describe("shouldUseSecureCookie", () => {
  it("auto suit le protocole", () => {
    expect(shouldUseSecureCookie("auto", "http")).toBe(false);
    expect(shouldUseSecureCookie("auto", "https")).toBe(true);
    expect(shouldUseSecureCookie(undefined, "https")).toBe(true);
    expect(shouldUseSecureCookie(undefined, null)).toBe(false);
  });

  it("true et false forcent la valeur", () => {
    expect(shouldUseSecureCookie("true", "http")).toBe(true);
    expect(shouldUseSecureCookie("false", "https")).toBe(false);
  });
});

describe("createRateLimiter", () => {
  it("bloque après 5 échecs", () => {
    const rl = createRateLimiter(5, 1000);
    for (let i = 0; i < 5; i++) {
      expect(rl.isBlocked("ip", 0)).toBe(false);
      rl.recordFailure("ip", 0);
    }
    expect(rl.isBlocked("ip", 0)).toBe(true);
  });

  it("débloque après la fenêtre", () => {
    const rl = createRateLimiter(5, 1000);
    for (let i = 0; i < 5; i++) rl.recordFailure("ip", 0);
    expect(rl.isBlocked("ip", 999)).toBe(true);
    expect(rl.isBlocked("ip", 1001)).toBe(false);
  });

  it("ne compte que les échecs : vérifier l'état ne consomme rien", () => {
    const rl = createRateLimiter(1, 1000);
    for (let i = 0; i < 10; i++) expect(rl.isBlocked("ip", 0)).toBe(false);
    rl.recordFailure("ip", 0);
    expect(rl.isBlocked("ip", 0)).toBe(true);
  });

  it("compte chaque clé séparément", () => {
    const rl = createRateLimiter(1, 1000);
    rl.recordFailure("a", 0);
    expect(rl.isBlocked("a", 0)).toBe(true);
    expect(rl.isBlocked("b", 0)).toBe(false);
  });

  it("plafonne le nombre de clés en évinçant la plus ancienne", () => {
    const rl = createRateLimiter(1, 1_000_000, 3);
    rl.recordFailure("a", 0);
    rl.recordFailure("b", 1);
    rl.recordFailure("c", 2);
    rl.recordFailure("d", 3); // évince "a"
    expect(rl.isBlocked("a", 4)).toBe(false);
    expect(rl.isBlocked("b", 4)).toBe(true);
    expect(rl.isBlocked("d", 4)).toBe(true);
  });
});

describe("clientKey", () => {
  it("utilise une clé unique sans TRUST_PROXY", () => {
    expect(clientKey("1.2.3.4", false)).toBe("global");
    expect(clientKey(null, false)).toBe("global");
  });

  it("utilise la valeur la plus à droite avec TRUST_PROXY", () => {
    expect(clientKey("6.6.6.6, 1.2.3.4", true)).toBe("1.2.3.4");
    expect(clientKey("1.2.3.4", true)).toBe("1.2.3.4");
    expect(clientKey("1.2.3.4, ", true)).toBe("1.2.3.4");
  });

  it("retombe sur global si l'en-tête est absent ou vide", () => {
    expect(clientKey(null, true)).toBe("global");
    expect(clientKey("", true)).toBe("global");
    expect(clientKey(" , ", true)).toBe("global");
  });
});

describe("safeNext", () => {
  const origin = "http://localhost:3000";

  it("conserve un chemin interne avec sa requête", () => {
    expect(safeNext("/transactions?x=1", origin)).toBe("/transactions?x=1");
    expect(safeNext("/a#b", origin)).toBe("/a#b");
  });

  it.each([
    ["//evil.com"],
    ["/\\evil.com"],
    ["/\t/evil.com"],
    ["/\n/evil.com"],
    ["/\u0000/evil.com"],
    ["https://evil.com"],
    ["http://localhost:3000.evil.com/x"],
    ["javascript:alert(1)"],
    [null],
    [""],
  ])("renvoie / pour %j", (input) => {
    expect(safeNext(input, origin)).toBe("/");
  });
});

describe("isPublicPath", () => {
  it.each([
    "/login",
    "/api/auth/login",
    "/api/health",
    "/_next/static/x.js",
    "/favicon.ico",
    "/robots.txt",
    "/icon.svg",
    "/apple-icon.png",
    "/manifest.webmanifest",
  ])("%s est public", (p) => {
    expect(isPublicPath(p)).toBe(true);
  });

  it.each([
    "/",
    "/transactions",
    "/foo.json",
    "/api/health/x",
    "/api/accounts",
    "/login/../api/accounts",
    "/favicon.ico.evil",
  ])("%s est protégé", (p) => {
    expect(isPublicPath(p)).toBe(false);
  });
});
