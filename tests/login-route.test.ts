import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "@/lib/auth/password";

type PostHandler = (request: Request) => Promise<Response>;

function loginRequest(password: string): Request {
  return new Request("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

describe("POST /api/auth/login", () => {
  let POST: PostHandler;

  beforeAll(async () => {
    process.env.SESSION_SECRET = "route-test-secret-route-test-secret-1";
    process.env.APP_PASSWORD_HASH = await hashPassword("bon-mot-de-passe");
    delete process.env.TRUST_PROXY;
  });

  beforeEach(async () => {
    // Module neuf = limiteurs en mémoire remis à zéro.
    vi.resetModules();
    ({ POST } = await import("@/app/api/auth/login/route"));
  });

  it("limite une rafale concurrente à 5 tentatives traitées", async () => {
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => POST(loginRequest("mauvais"))),
    );
    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 429)).toHaveLength(5);
    expect(statuses.filter((s) => s === 401)).toHaveLength(5);
  });

  it("ne compte pas les connexions réussies", async () => {
    for (let i = 0; i < 8; i++) {
      const res = await POST(loginRequest("bon-mot-de-passe"));
      expect(res.status).toBe(200);
    }
    const res = await POST(loginRequest("mauvais"));
    expect(res.status).toBe(401);
  });

  it("ne compte pas les requêtes invalides", async () => {
    for (let i = 0; i < 8; i++) {
      const res = await POST(loginRequest(""));
      expect(res.status).toBe(400);
    }
    expect((await POST(loginRequest("mauvais"))).status).toBe(401);
  });

  it("répond 429 une fois la limite atteinte, même avec le bon mot de passe", async () => {
    for (let i = 0; i < 5; i++) await POST(loginRequest("mauvais"));
    const res = await POST(loginRequest("bon-mot-de-passe"));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: "Trop de tentatives, réessayez dans quelques minutes.",
    });
  });
});
