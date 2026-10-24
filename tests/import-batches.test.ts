import { describe, expect, it } from "vitest";
import { importInBatches } from "@/lib/import-batches";

const rows = Array.from({ length: 7 }, (_, i) => i + 1);

describe("importInBatches", () => {
  it("envoie tout par lots et renvoie le total", async () => {
    const sent: number[][] = [];
    const r = await importInBatches(rows, 3, async (chunk) => void sent.push(chunk));
    expect(sent).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    expect(r).toEqual({ imported: 7 });
  });

  it("s'arrête au premier lot en échec et compte uniquement les lots enregistrés", async () => {
    const boom = new Error("boom");
    let call = 0;
    const r = await importInBatches(rows, 3, async () => {
      if (++call === 2) throw boom;
    });
    expect(call).toBe(2);
    expect(r).toEqual({ imported: 3, error: boom });
  });

  it("reprend à partir du décalage et n'envoie que les lignes restantes", async () => {
    let call = 0;
    await importInBatches(rows, 3, async () => {
      if (++call === 2) throw new Error("boom");
    });
    const sent: number[][] = [];
    const r = await importInBatches(rows, 3, async (c) => void sent.push(c), 3);
    expect(sent).toEqual([[4, 5, 6], [7]]);
    expect(r).toEqual({ imported: 7 });
  });

  it("une reprise qui échoue de nouveau garde le décalage atteint", async () => {
    const r = await importInBatches(rows, 3, async (c) => {
      if (c[0] === 7) throw new Error("encore");
    }, 3);
    expect(r.imported).toBe(6);
    expect(r.error).toBeInstanceOf(Error);
  });
});
