import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  createSession,
  shouldUseSecureCookie,
  verifySession,
} from "@/lib/auth/session";
import { createRateLimiter } from "@/lib/auth/rate-limit";

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
  it("autorise 5 requêtes puis refuse la 6e", () => {
    const rl = createRateLimiter(5, 1000);
    for (let i = 0; i < 5; i++) expect(rl.hit("ip", 0)).toBe(true);
    expect(rl.hit("ip", 0)).toBe(false);
  });

  it("autorise de nouveau après la fenêtre", () => {
    const rl = createRateLimiter(5, 1000);
    for (let i = 0; i < 6; i++) rl.hit("ip", 0);
    expect(rl.hit("ip", 999)).toBe(false);
    expect(rl.hit("ip", 1001)).toBe(true);
  });

  it("compte chaque clé séparément", () => {
    const rl = createRateLimiter(1, 1000);
    expect(rl.hit("a", 0)).toBe(true);
    expect(rl.hit("a", 0)).toBe(false);
    expect(rl.hit("b", 0)).toBe(true);
  });
});
