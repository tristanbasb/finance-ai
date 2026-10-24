import { describe, expect, it } from "vitest";
import { isCrossSiteRequest, type CsrfInput } from "@/lib/auth/csrf";

const base: CsrfInput = {
  method: "POST",
  pathname: "/api/transactions",
  host: "localhost:3000",
  origin: null,
  secFetchSite: null,
  forwardedHost: null,
};
const check = (patch: Partial<CsrfInput>) => isCrossSiteRequest({ ...base, ...patch });

describe("isCrossSiteRequest", () => {
  it("accepte une requête same-origin d'un navigateur", () => {
    expect(check({ secFetchSite: "same-origin", origin: "http://localhost:3000" })).toBe(false);
  });

  it("accepte Sec-Fetch-Site: none (saisie directe)", () => {
    expect(check({ secFetchSite: "none" })).toBe(false);
  });

  it("accepte une requête sans Origin ni Sec-Fetch-Site (curl, scripts)", () => {
    expect(check({})).toBe(false);
  });

  it("refuse une requête cross-site", () => {
    expect(check({ secFetchSite: "cross-site", origin: "http://evil.example" })).toBe(true);
    expect(check({ origin: "http://evil.example" })).toBe(true);
  });

  it("refuse une requête same-site d'un autre port", () => {
    expect(check({ secFetchSite: "same-site", origin: "http://localhost:4000" })).toBe(true);
    expect(check({ origin: "http://localhost:4000" })).toBe(true);
  });

  it("refuse Origin: null (contexte opaque)", () => {
    expect(check({ origin: "null" })).toBe(true);
  });

  it("protège aussi la connexion et la déconnexion", () => {
    expect(check({ pathname: "/api/auth/login", origin: "http://evil.example" })).toBe(true);
    expect(check({ pathname: "/api/auth/logout", secFetchSite: "cross-site" })).toBe(true);
  });

  it("ne s'applique pas aux méthodes sûres ni hors de /api", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(check({ method, origin: "http://evil.example", secFetchSite: "cross-site" })).toBe(false);
    }
    expect(check({ pathname: "/login", origin: "http://evil.example" })).toBe(false);
    expect(check({ pathname: "/apix", origin: "http://evil.example" })).toBe(false);
  });

  it("ports par défaut et casse normalisés", () => {
    expect(check({ host: "Finance.Example.com", origin: "https://finance.example.com" })).toBe(false);
    expect(check({ host: "finance.example.com:443", origin: "https://finance.example.com" })).toBe(false);
  });

  it("Sec-Fetch-Site same-origin suffit, même si Origin diffère de Host (proxy qui réécrit Host)", () => {
    expect(check({ secFetchSite: "same-origin", host: "127.0.0.1:3000", origin: "https://finance.example.com" })).toBe(false);
  });

  it("Sec-Fetch-Site cross-site est refusé même avec un Origin identique à l'hôte", () => {
    expect(check({ secFetchSite: "cross-site", origin: "http://localhost:3000" })).toBe(true);
  });

  it("sans Sec-Fetch-Site : Origin comparé à X-Forwarded-Host (1re valeur) s'il existe, sans TRUST_PROXY", () => {
    const behindProxy = { host: "127.0.0.1:3000", forwardedHost: "finance.example.com, 10.0.0.1", origin: "https://finance.example.com" };
    expect(check(behindProxy)).toBe(false);
    expect(check({ ...behindProxy, origin: "https://evil.example" })).toBe(true);
  });

  it("sans Sec-Fetch-Site : Origin différent de Host refusé", () => {
    expect(check({ host: "127.0.0.1:3000", origin: "https://finance.example.com" })).toBe(true);
  });
});

describe("proxy — CSRF", () => {
  it("répond 403 à un POST cross-site, y compris sur /api/auth/login", async () => {
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("@/proxy");
    const req = new NextRequest("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { host: "localhost:3000", origin: "http://evil.example" },
    });
    const res = await proxy(req);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Requête refusée" });
  });

  it("laisse passer un POST same-origin vers /api/auth/login", async () => {
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("@/proxy");
    const req = new NextRequest("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { host: "localhost:3000", origin: "http://localhost:3000", "sec-fetch-site": "same-origin" },
    });
    const res = await proxy(req);
    expect(res.status).toBe(200);
  });
});
