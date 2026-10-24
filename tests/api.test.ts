import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ConflictError, NotFoundError, parseId, readJson, withErrors } from "@/lib/api";

describe("withErrors", () => {
  it("laisse passer les réponses normales", async () => {
    const res = await withErrors(async () => Response.json({ ok: true }, { status: 201 }))();
    expect(res.status).toBe(201);
  });

  it("ZodError → 400 avec issues", async () => {
    const res = await withErrors(async () => {
      z.object({ a: z.number() }).parse({ a: "x" });
      return Response.json({});
    })();
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Données invalides");
    expect(body.issues).toHaveLength(1);
  });

  it("NotFoundError → 404, ConflictError → 409", async () => {
    const nf = await withErrors(async () => {
      throw new NotFoundError();
    })();
    expect(nf.status).toBe(404);
    expect(await nf.json()).toEqual({ error: "Introuvable" });
    const cf = await withErrors(async () => {
      throw new ConflictError("Ce compte contient des données, archivez-le plutôt.");
    })();
    expect(cf.status).toBe(409);
    expect(await cf.json()).toEqual({ error: "Ce compte contient des données, archivez-le plutôt." });
  });

  it("erreur inconnue → 500 générique (journalisée)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await withErrors(async () => {
      throw new Error("secret");
    })();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Erreur interne" });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("parseId / readJson", () => {
  it("accepte un entier positif, rejette le reste en 400", async () => {
    expect(await parseId(Promise.resolve({ id: "12" }))).toBe(12);
    for (const bad of ["0", "-1", "1.5", "abc", "", "01", "1e3"]) {
      const res = await withErrors(async () => {
        await parseId(Promise.resolve({ id: bad }));
        return Response.json({});
      })();
      expect(res.status).toBe(400);
    }
  });

  it("JSON invalide → 400", async () => {
    const res = await withErrors(async () => {
      await readJson(new Request("http://x", { method: "POST", body: "{nope" }));
      return Response.json({});
    })();
    expect(res.status).toBe(400);
  });
});
