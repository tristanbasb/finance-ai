import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { getDb } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { seedDefaults } from "@/lib/db/seed";
import type { Ai } from "@/lib/ai/client";
import {
  defaultAccountId,
  NoAmountError,
  normalizeProposal,
  parseTransaction,
  type ParseContext,
} from "@/lib/ai/parse-transaction";
import { POST } from "@/app/api/ai/parse-transaction/route";

const ctx: ParseContext = {
  text: "12,50 resto midi avec Paul",
  today: "2026-10-25",
  categories: [
    { id: 1, name: "Restaurants", kind: "expense" },
    { id: 11, name: "Salaire", kind: "income" },
  ],
  accounts: [
    { id: 5, name: "Livret", type: "savings", archived: false },
    { id: 6, name: "Courant", type: "checking", archived: false },
    { id: 7, name: "Ancien", type: "checking", archived: true },
  ],
};

const valid = {
  amountCents: 1250,
  kind: "expense" as const,
  categoryId: 1,
  label: "Resto midi avec Paul",
  date: "2026-10-25",
  accountId: 6,
};

describe("normalizeProposal", () => {
  it("sortie valide conservée", () => {
    expect(normalizeProposal(valid, ctx)).toEqual(valid);
  });

  it("montant arrondi à l'entier ; négatif -> absolu et dépense sauf revenu explicite", () => {
    expect(normalizeProposal({ ...valid, amountCents: 1250.4 }, ctx).amountCents).toBe(1250);
    const n = normalizeProposal({ ...valid, amountCents: -1250, kind: "income", categoryId: 11 }, ctx);
    expect(n.amountCents).toBe(1250);
    expect(n.kind).toBe("income");
    expect(normalizeProposal({ ...valid, amountCents: -1250, kind: "expense" }, ctx).kind).toBe("expense");
    expect(normalizeProposal({ ...valid, amountCents: -1250, kind: undefined }, ctx).kind).toBe("expense");
  });

  it("0, NaN ou absent -> NoAmountError avec partial", () => {
    for (const amountCents of [0, Number.NaN, null, undefined, 0.2]) {
      let err: unknown;
      try {
        normalizeProposal({ ...valid, amountCents }, ctx);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(NoAmountError);
      expect((err as NoAmountError).message).toBe("Je n'ai pas trouvé de montant.");
      expect((err as NoAmountError).partial).toMatchObject({ label: "Resto midi avec Paul", categoryId: 1 });
    }
  });

  it("categoryId hors liste ou de mauvais type -> null", () => {
    expect(normalizeProposal({ ...valid, categoryId: 999 }, ctx).categoryId).toBeNull();
    expect(normalizeProposal({ ...valid, categoryId: 11 }, ctx).categoryId).toBeNull();
    expect(normalizeProposal({ ...valid, kind: "income", categoryId: 11 }, ctx).categoryId).toBe(11);
  });

  it("accountId inconnu ou archivé -> null", () => {
    expect(normalizeProposal({ ...valid, accountId: 99 }, ctx).accountId).toBeNull();
    expect(normalizeProposal({ ...valid, accountId: 7 }, ctx).accountId).toBeNull();
    expect(normalizeProposal({ ...valid, accountId: 5 }, ctx).accountId).toBe(5);
  });

  it("date invalide, inexistante ou trop lointaine -> aujourd'hui", () => {
    for (const date of ["hier", "2026-02-30", "2026-13-01", "2028-01-01", "", undefined]) {
      expect(normalizeProposal({ ...valid, date }, ctx).date).toBe("2026-10-25");
    }
    expect(normalizeProposal({ ...valid, date: "2026-10-20" }, ctx).date).toBe("2026-10-20");
    expect(normalizeProposal({ ...valid, date: "2027-03-01" }, ctx).date).toBe("2027-03-01");
  });

  it("libellé tronqué à 200, rogné, repli sur le texte d'origine", () => {
    expect(normalizeProposal({ ...valid, label: "x".repeat(300) }, ctx).label).toHaveLength(200);
    expect(normalizeProposal({ ...valid, label: "  Café  " }, ctx).label).toBe("Café");
    expect(normalizeProposal({ ...valid, label: "   " }, ctx).label).toBe(ctx.text);
    const long = { ...ctx, text: "y".repeat(300) };
    expect(normalizeProposal({ ...valid, label: "" }, long).label).toHaveLength(200);
  });
});

describe("defaultAccountId", () => {
  it("premier checking non archivé, sinon premier non archivé, sinon null", () => {
    expect(defaultAccountId(ctx.accounts)).toBe(6);
    expect(defaultAccountId([ctx.accounts[0], ctx.accounts[2]])).toBe(5);
    expect(defaultAccountId([ctx.accounts[2]])).toBeNull();
    expect(defaultAccountId([])).toBeNull();
  });
});

function mockAi(output: unknown) {
  const parse = vi.fn(async () => ({ parsed_output: output, stop_reason: "end_turn", content: [] }));
  const ai = { client: { messages: { parse } } as unknown as Anthropic, model: "claude-opus-5-5" } satisfies Ai;
  return { ai, parse };
}

describe("parseTransaction", () => {
  it("appelle Claude (max_tokens 400, contexte dans le prompt) et normalise", async () => {
    const { ai, parse } = mockAi({ ...valid, categoryId: 999 });
    const out = await parseTransaction(ai, ctx);
    expect(out).toEqual({ ...valid, categoryId: null });
    const params = (parse.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(params.max_tokens).toBe(400);
    expect(JSON.stringify(params)).toContain("2026-10-25");
    expect(JSON.stringify(params)).toContain("Restaurants");
  });

  it("sortie nulle -> erreur", async () => {
    await expect(parseTransaction(mockAi(null).ai, ctx)).rejects.toThrow();
  });
});

const json = { "Content-Type": "application/json" };
const post = (body: unknown) =>
  POST(new Request("http://localhost/api/ai/parse-transaction", { method: "POST", headers: json, body: JSON.stringify(body) }));

describe("POST /api/ai/parse-transaction", () => {
  let savedKey: string | undefined;
  beforeEach(() => {
    savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedKey;
    vi.restoreAllMocks();
  });

  it("503 sans clé, avant toute validation", async () => {
    expect((await post({ text: "12 euros" })).status).toBe(503);
    expect((await post({ text: "" })).status).toBe(503);
  });

  describe("avec clé", () => {
    beforeEach(() => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";
      const db = getDb();
      try {
        runMigrations(db);
        seedDefaults(db);
      } catch {
        // déjà initialisée (singleton)
      }
      vi.spyOn(console, "error").mockImplementation(() => {});
    });

    it("400 texte vide ou trop long", async () => {
      expect((await post({ text: "   " })).status).toBe(400);
      expect((await post({ text: "a".repeat(501) })).status).toBe(400);
      expect((await post({})).status).toBe(400);
    });

    it("200 proposition avec compte par défaut résolu", async () => {
      vi.spyOn(Anthropic.Messages.prototype, "parse").mockResolvedValue({
        parsed_output: { ...valid, categoryId: 999, accountId: null, date: "2026-10-20" },
      } as never);
      const res = await post({ text: "  12,50 resto  " });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ amountCents: 1250, kind: "expense", categoryId: null, date: "2026-10-20" });
      expect(typeof body.accountId).toBe("number");
    });

    it("422 sans montant, avec partial", async () => {
      vi.spyOn(Anthropic.Messages.prototype, "parse").mockResolvedValue({
        parsed_output: { ...valid, amountCents: 0, accountId: null },
      } as never);
      const res = await post({ text: "resto midi" });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error).toBe("Je n'ai pas trouvé de montant.");
      expect(body.partial).toMatchObject({ label: "Resto midi avec Paul", kind: "expense" });
      expect(body.partial.amountCents).toBeUndefined();
      expect(typeof body.partial.accountId).toBe("number");
    });
  });
});
