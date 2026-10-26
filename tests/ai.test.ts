import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { createDb, getDb } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { seedDefaults } from "@/lib/db/seed";
import { accounts, aiCache, categories, holdings, news, newsSymbols } from "@/lib/db/schema";
import { createTransactions } from "@/lib/queries/transactions";
import { AI_DISABLED_MESSAGE, aiErrorInfo, getAi, type Ai } from "@/lib/ai/client";
import { aiTools, runTool } from "@/lib/ai/tools";
import { writeTools } from "@/lib/ai/write-tools";
import { categorize } from "@/lib/ai/categorize";
import { chatRequest, encodeSse, runChat, type ChatEvent } from "@/lib/ai/chat";
import { getInsights } from "@/lib/ai/insights";
import { decodeSse } from "@/lib/sse";
import { GET as statusGET } from "@/app/api/ai/status/route";
import { HEARTBEAT_MS, POST as chatPOST } from "@/app/api/ai/chat/route";
import { POST as categorizePOST } from "@/app/api/ai/categorize/route";
import { GET as insightsGET } from "@/app/api/ai/insights/route";

function freshDb() {
  const db = createDb(":memory:");
  runMigrations(db);
  seedDefaults(db);
  return db;
}

type TestDb = ReturnType<typeof freshDb>;

function catId(db: TestDb, name: string): number {
  return db.select().from(categories).where(eq(categories.name, name)).get()!.id;
}

function seedTransactions(db: TestDb) {
  const acc = db.select().from(accounts).get()!.id;
  createTransactions(db, [
    { accountId: acc, date: "2026-10-01", amount: 250_000, label: "VIR SALAIRE ACME", categoryId: catId(db, "Salaire") },
    { accountId: acc, date: "2026-10-03", amount: -85_000, label: "PRLV LOYER OCTOBRE", categoryId: catId(db, "Logement") },
    { accountId: acc, date: "2026-10-05", amount: -4_550, label: "CARREFOUR MARKET", categoryId: catId(db, "Alimentation") },
    { accountId: acc, date: "2026-10-12", amount: -1_299, label: "NETFLIX", categoryId: catId(db, "Abonnements") },
    { accountId: acc, date: "2026-09-03", amount: -85_000, label: "PRLV LOYER SEPTEMBRE", categoryId: catId(db, "Logement") },
    { accountId: acc, date: "2026-09-20", amount: -12_000, label: "Restaurant", note: "anniversaire loyer ami" },
  ]);
  return acc;
}

function req(url: string, init?: RequestInit) {
  return new Request(`http://localhost${url}`, init);
}

const PING = ": ping\n\n";

const ENV_KEYS = ["ANTHROPIC_API_KEY", "CLAUDE_MODEL"] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.restoreAllMocks();
});

describe("getAi", () => {
  it("null sans clé (absente, vide ou blanche)", () => {
    expect(getAi()).toBeNull();
    process.env.ANTHROPIC_API_KEY = "   ";
    expect(getAi()).toBeNull();
  });

  it("client + modèle par défaut, surchargeable par CLAUDE_MODEL ; client réutilisé pour une même clé", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const a = getAi();
    expect(a?.model).toBe("claude-opus-5-5");
    expect(a?.client).toBeInstanceOf(Anthropic);
    process.env.CLAUDE_MODEL = "claude-sonnet-5-5";
    const b = getAi();
    expect(b?.model).toBe("claude-sonnet-5-5");
    expect(b?.client).toBe(a?.client);
  });
});

describe("routes IA sans clé", () => {
  it("GET /api/ai/status → 200 { enabled: false, model }", async () => {
    const res = await statusGET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: false, model: "claude-opus-5-5" });
  });

  it("GET /api/ai/status → enabled: true avec une clé", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.CLAUDE_MODEL = "claude-haiku-5-5";
    expect(await (await statusGET()).json()).toEqual({ enabled: true, model: "claude-haiku-5-5" });
  });

  it("chat, catégorisation et analyses → 503 avec le message exact", async () => {
    const json = { "Content-Type": "application/json" };
    const responses = [
      await chatPOST(
        req("/api/ai/chat", {
          method: "POST",
          headers: json,
          body: JSON.stringify({ content: "Bonjour" }),
        }),
      ),
      await categorizePOST(
        req("/api/ai/categorize", { method: "POST", headers: json, body: JSON.stringify({ labels: ["NETFLIX"] }) }),
      ),
      await insightsGET(req("/api/ai/insights?month=2026-10")),
    ];
    for (const res of responses) {
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: AI_DISABLED_MESSAGE });
    }
    expect(AI_DISABLED_MESSAGE).toBe("Assistant IA désactivé : ajoutez ANTHROPIC_API_KEY dans .env");
  });
});

describe("aiErrorInfo", () => {
  it("auth → 502 clé invalide, limite → 429, autre → 502, erreur non Anthropic → null", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const headers = new Headers();
    expect(aiErrorInfo(new Anthropic.AuthenticationError(401, {}, "bad key", headers))).toEqual({
      status: 502,
      message: "Clé API Claude invalide",
    });
    expect(aiErrorInfo(new Anthropic.RateLimitError(429, {}, "slow down", headers))).toEqual({
      status: 429,
      message: "Limite de l'API Claude atteinte, réessayez plus tard.",
    });
    expect(aiErrorInfo(new Anthropic.InternalServerError(529, {}, "overloaded", headers))).toEqual({
      status: 502,
      message: "Le service Claude est indisponible.",
    });
    expect(aiErrorInfo(new Anthropic.APIConnectionError({ message: "ECONNRESET" }))).toEqual({
      status: 502,
      message: "Le service Claude est indisponible.",
    });
    expect(aiErrorInfo(new Anthropic.AnthropicError("Failed to parse structured output"))).toEqual({
      status: 502,
      message: "Le service Claude est indisponible.",
    });
    expect(aiErrorInfo(new Anthropic.APIUserAbortError())).toBeNull();
    expect(aiErrorInfo(new Error("autre"))).toBeNull();
  });
});

describe("outils", () => {
  it("définit les 6 outils en lecture seule", () => {
    expect(aiTools.map((t) => t.name).sort()).toEqual([
      "get_goals",
      "get_holdings",
      "get_news",
      "get_overview",
      "search_transactions",
      "spending_by_category",
    ]);
  });

  it("get_news est en lecture seule : dans aiTools, absent de writeTools", () => {
    expect(aiTools.some((t) => t.name === "get_news")).toBe(true);
    expect(writeTools.some((t) => t.name === "get_news")).toBe(false);
  });

  it("get_news filtre par symbole (insensible à la casse), jours, tri et format", async () => {
    const db = freshDb();
    const now = Date.now();
    const add = (uuid: string, title: string, titleFr: string | null, at: number, syms: string[]) => {
      const row = db
        .insert(news)
        .values({ uuid, title, titleFr, publisher: "Yahoo", link: `https://x/${uuid}`, publishedAt: at, fetchedAt: now })
        .returning({ id: news.id })
        .get();
      for (const s of syms) db.insert(newsSymbols).values({ newsId: row.id, symbol: s }).run();
    };
    add("1", "Older", "Plus ancien", now - 2 * 86_400_000, ["CW8"]);
    add("2", "Newer", null, now - 3_600_000, ["CW8", "AAPL"]);
    add("3", "Other", "Autre", now - 3_600_000, ["AAPL"]);
    add("4", "Ancient", "Très ancien", now - 20 * 86_400_000, ["CW8"]);
    type R = {
      count: number;
      articles: { symbols: string[]; title: string; original_title: string; publisher: string; published_at: string; link: string }[];
    };
    const r = (await runTool(db, "get_news", { symbol: "cw8" })) as R;
    expect(r.count).toBe(2);
    expect(r.articles.map((a) => a.original_title)).toEqual(["Newer", "Older"]);
    expect(r.articles[0].title).toBe("Newer");
    expect(r.articles[1].title).toBe("Plus ancien");
    expect(r.articles[0].symbols.sort()).toEqual(["AAPL", "CW8"]);
    expect(r.articles[0].published_at).toBe(new Date(now - 3_600_000).toISOString());
    expect(r.articles[0].link).toBe("https://x/2");
    expect(((await runTool(db, "get_news", { symbol: "CW8", days: 30 })) as R).count).toBe(3);
    expect(((await runTool(db, "get_news", {})) as R).count).toBe(3);
    expect(((await runTool(db, "get_news", { limit: 1 })) as R).articles).toHaveLength(1);
    expect(await runTool(db, "get_news", { days: 99 })).toHaveProperty("error");
  });

  it("search_transactions { q: 'loyer' } filtre libellés et notes, montants en euros", async () => {
    const db = freshDb();
    seedTransactions(db);
    const result = (await runTool(db, "search_transactions", { q: "loyer" })) as {
      count: number;
      total: number;
      truncated: boolean;
      transactions: { date: string; label: string; amount: number; category: string }[];
    };
    expect(result.count).toBe(3);
    expect(result.truncated).toBe(false);
    expect(result.total).toBe(-1820);
    expect(result.transactions.map((t) => t.label)).toEqual([
      "PRLV LOYER OCTOBRE",
      "Restaurant",
      "PRLV LOYER SEPTEMBRE",
    ]);
    expect(result.transactions[0]).toMatchObject({ date: "2026-10-03", amount: -850, category: "Logement" });
    expect(result.transactions[1].category).toBe("Sans catégorie");
  });

  it("search_transactions : mois, catégorie par nom, type et bornes de montant (valeur absolue)", async () => {
    const db = freshDb();
    seedTransactions(db);
    const byMonth = (await runTool(db, "search_transactions", { month: "2026-10", kind: "expense", min_amount: 10 })) as {
      transactions: { label: string }[];
    };
    expect(byMonth.transactions.map((t) => t.label)).toEqual(["NETFLIX", "CARREFOUR MARKET", "PRLV LOYER OCTOBRE"]);
    const byCategory = (await runTool(db, "search_transactions", { category: "logement", max_amount: 1000 })) as {
      count: number;
    };
    expect(byCategory.count).toBe(2);
    const limited = (await runTool(db, "search_transactions", { limit: 2 })) as { count: number; truncated: boolean; transactions: unknown[] };
    expect(limited).toMatchObject({ count: 6, truncated: true });
    expect(limited.transactions).toHaveLength(2);
    const unknownCat = (await runTool(db, "search_transactions", { category: "Inexistante" })) as { error?: string };
    expect(unknownCat.error).toMatch(/Catégorie inconnue/);
  });

  it("spending_by_category et get_overview renvoient des euros", async () => {
    const db = freshDb();
    seedTransactions(db);
    db.update(categories).set({ monthlyBudget: 50_000 }).where(eq(categories.name, "Alimentation")).run();
    const spending = (await runTool(db, "spending_by_category", { month: "2026-10" })) as {
      total_expenses: number;
      categories: { category: string; amount: number; budget?: number }[];
    };
    expect(spending.total_expenses).toBe(908.49);
    expect(spending.categories[0]).toMatchObject({ category: "Logement", amount: 850 });
    expect(spending.categories.find((c) => c.category === "Alimentation")).toMatchObject({ amount: 45.5, budget: 500 });

    const overview = (await runTool(db, "get_overview", {}, "2026-10-24")) as {
      net_worth: number;
      current_month: { income: number; expenses: number };
    };
    expect(overview.net_worth).toBe(621.51);
    expect(overview.current_month).toMatchObject({ income: 2500, expenses: -908.49 });
  });

  it("get_overview : chaque compte donne espèces, positions et total ; le patrimoine net est la somme des totaux", async () => {
    const db = freshDb();
    const acc = db.select().from(accounts).get()!.id;
    db.update(accounts).set({ initialBalance: 72_986 }).where(eq(accounts.id, acc)).run();
    db.insert(holdings)
      .values({ accountId: acc, symbol: "CW8", name: "MSCI World", assetType: "etf", quantity: 2, avgPrice: 38_508 })
      .run();
    const overview = (await runTool(db, "get_overview", {}, "2026-10-24")) as {
      net_worth: number;
      accounts: { cash_balance: number; investments: number; total: number }[];
    };
    const account = overview.accounts.find((a) => a.total !== 0)!;
    expect(account).toMatchObject({ cash_balance: 729.86, investments: 770.16, total: 1500.02 });
    expect(overview.accounts[0]).not.toHaveProperty("balance");
    const sum = overview.accounts.reduce((s, a) => s + a.total, 0);
    expect(overview.net_worth).toBeCloseTo(sum, 2);
  });

  it("get_holdings et get_goals", async () => {
    const db = freshDb();
    const acc = db.select().from(accounts).get()!.id;
    db.insert(holdings)
      .values({ accountId: acc, symbol: "CW8", name: "MSCI World", assetType: "etf", quantity: 2, avgPrice: 45_000 })
      .run();
    const h = (await runTool(db, "get_holdings", {})) as { total_value: number; holdings: { symbol: string; unit_price: number }[] };
    expect(h.total_value).toBe(900);
    expect(h.holdings[0]).toMatchObject({ symbol: "CW8", unit_price: 450 });
    const g = (await runTool(db, "get_goals", {})) as { goals: unknown[] };
    expect(g.goals).toEqual([]);
  });

  it("get_holdings ignore les positions des comptes archivés (comme get_overview)", async () => {
    const db = freshDb();
    const acc = db.select().from(accounts).get()!.id;
    const archived = db
      .insert(accounts)
      .values({ name: "Ancien PEA", type: "investment", color: "#888888", archived: true })
      .returning()
      .get().id;
    db.insert(holdings)
      .values([
        { accountId: acc, symbol: "CW8", name: "MSCI World", assetType: "etf", quantity: 2, avgPrice: 45_000 },
        { accountId: archived, symbol: "OLD", name: "Vieille ligne", assetType: "etf", quantity: 1, avgPrice: 10_000 },
      ])
      .run();
    const h = (await runTool(db, "get_holdings", {})) as { total_value: number; total_cost: number; holdings: { symbol: string }[] };
    expect(h.total_value).toBe(900);
    expect(h.total_cost).toBe(900);
    expect(h.holdings.map((x) => x.symbol)).toEqual(["CW8"]);
  });

  it("outil inconnu ou entrée invalide → { error } sans lever", async () => {
    const db = freshDb();
    expect(await runTool(db, "delete_everything", {})).toEqual({ error: expect.any(String) });
    expect(await runTool(db, "search_transactions", { limit: 5000 })).toEqual({ error: expect.any(String) });
    expect(await runTool(db, "search_transactions", "pas un objet")).toEqual({ error: expect.any(String) });
  });
});

function mockParseClient(output: unknown) {
  const parse = vi.fn(async () => ({ parsed_output: output, stop_reason: "end_turn", content: [] }));
  const ai = { client: { messages: { parse } } as unknown as Anthropic, model: "claude-opus-5-5" } satisfies Ai;
  return { ai, parse };
}

describe("categorize", () => {
  const cats = [
    { id: 1, name: "Alimentation", kind: "expense" as const },
    { id: 11, name: "Salaire", kind: "income" as const },
  ];

  it("associe par index et remplace les ids hors liste par null", async () => {
    const { ai, parse } = mockParseClient({
      results: [
        { index: 1, categoryId: 99 },
        { index: 0, categoryId: 1 },
        { index: 2, categoryId: 11 },
      ],
    });
    expect(await categorize(["CARREFOUR", "INCONNU", "VIR SALAIRE"], cats, ai)).toEqual([1, null, 11]);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("réponse de mauvaise longueur ou illisible → tout à null", async () => {
    expect(await categorize(["A", "B"], cats, mockParseClient({ results: [{ index: 0, categoryId: 1 }] }).ai)).toEqual([
      null,
      null,
    ]);
    expect(await categorize(["A"], cats, mockParseClient(null).ai)).toEqual([null]);
  });

  it("sortie structurée illisible (AnthropicError du SDK) → propagée", async () => {
    const failing = {
      client: {
        messages: {
          parse: async () => {
            throw new Anthropic.AnthropicError("Failed to parse structured output");
          },
        },
      } as unknown as Anthropic,
      model: "m",
    };
    await expect(categorize(["A"], cats, failing)).rejects.toBeInstanceOf(Anthropic.AnthropicError);
  });

  it("propage les erreurs de l'API", async () => {
    const failing = {
      client: {
        messages: {
          parse: async () => {
            throw new Anthropic.RateLimitError(429, {}, "slow", new Headers());
          },
        },
      } as unknown as Anthropic,
      model: "m",
    };
    await expect(categorize(["A"], cats, failing)).rejects.toBeInstanceOf(Anthropic.RateLimitError);
  });
});

describe("getInsights", () => {
  it("mois vide → message unique sans appel à l'API", async () => {
    const db = freshDb();
    const { ai, parse } = mockParseClient({ insights: ["x"] });
    const insights = await getInsights(db, "2026-10", false, ai);
    expect(insights).toHaveLength(1);
    expect(parse).not.toHaveBeenCalled();
  });

  it("génère, met en cache sous insights:<mois>, puis régénère avec refresh", async () => {
    const db = freshDb();
    seedTransactions(db);
    const { ai, parse } = mockParseClient({ insights: ["  Le loyer pèse 34 % des revenus.  ", "", "Épargne : 63 %."] });
    expect(await getInsights(db, "2026-10", false, ai)).toEqual(["Le loyer pèse 34 % des revenus.", "Épargne : 63 %."]);
    const cached = db.select().from(aiCache).where(eq(aiCache.key, "insights:2026-10")).get();
    expect(JSON.parse(cached!.value)).toEqual(["Le loyer pèse 34 % des revenus.", "Épargne : 63 %."]);
    await getInsights(db, "2026-10", false, ai);
    expect(parse).toHaveBeenCalledTimes(1);
    await getInsights(db, "2026-10", true, ai);
    expect(parse).toHaveBeenCalledTimes(2);
  });
});

describe("getInsights — expiration du cache", () => {
  const T0 = new Date("2026-10-24T08:00:00Z").getTime();
  const HOUR = 3_600_000;

  it("mois en cours : cache périmé après 24 h, régénéré à la demande suivante", async () => {
    const db = freshDb();
    seedTransactions(db);
    const { ai, parse } = mockParseClient({ insights: ["A"] });
    await getInsights(db, "2026-10", false, ai, "2026-10-24", T0);
    await getInsights(db, "2026-10", false, ai, "2026-10-24", T0 + 23 * HOUR);
    expect(parse).toHaveBeenCalledTimes(1);
    await getInsights(db, "2026-10", false, ai, "2026-10-25", T0 + 25 * HOUR);
    expect(parse).toHaveBeenCalledTimes(2);
    const row = db.select().from(aiCache).where(eq(aiCache.key, "insights:2026-10")).get()!;
    expect(row.createdAt).toBe(T0 + 25 * HOUR);
  });

  it("mois passé : le cache ne périme jamais", async () => {
    const db = freshDb();
    seedTransactions(db);
    const { ai, parse } = mockParseClient({ insights: ["A"] });
    await getInsights(db, "2026-10", false, ai, "2026-11-05", T0);
    await getInsights(db, "2026-10", false, ai, "2027-03-01", T0 + 120 * 24 * HOUR);
    expect(parse).toHaveBeenCalledTimes(1);
  });
});

describe("chat", () => {
  it("encodeSse produit un événement SSE data: JSON", () => {
    expect(encodeSse({ type: "text", text: "Bonjour\n" })).toBe('data: {"type":"text","text":"Bonjour\\n"}\n\n');
    expect(encodeSse({ type: "done" })).toBe('data: {"type":"done"}\n\n');
  });

  it("decodeSse : événements complets, reste conservé, données invalides ignorées", () => {
    const stream = encodeSse({ type: "tool", name: "get_goals" }) + "data: pas du json\n\n" + 'data: {"type":"inconnu"}\n\n';
    const full = decodeSse(stream + 'data: {"type":"te');
    expect(full.events).toEqual([{ type: "tool", name: "get_goals" }]);
    expect(full.rest).toBe('data: {"type":"te');
    const next = decodeSse(full.rest + 'xt","text":"a"}\r\n\r\n');
    expect(next).toEqual({ events: [{ type: "text", text: "a" }], rest: "" });
  });

  it("decodeSse ignore les commentaires « : ping » entre et dans les fragments", () => {
    const text = encodeSse({ type: "text", text: "a" });
    const between = decodeSse(PING + text + PING + encodeSse({ type: "done" }));
    expect(between).toEqual({ events: [{ type: "text", text: "a" }, { type: "done" }], rest: "" });
    // Commentaire dans un même événement, et commentaire coupé entre deux fragments.
    expect(decodeSse(`: ping\ndata: {"type":"done"}\n\n`).events).toEqual([{ type: "done" }]);
    const first = decodeSse(text + ": pi");
    expect(first.events).toEqual([{ type: "text", text: "a" }]);
    expect(decodeSse(`${first.rest}ng\n\n${text}`)).toEqual({ events: [{ type: "text", text: "a" }], rest: "" });
  });

  it("valide la requête { content } (rognée, 1–8000 caractères)", () => {
    expect(chatRequest.parse({ content: "  Salut " })).toEqual({ content: "Salut" });
    expect(chatRequest.safeParse({ content: "   " }).success).toBe(false);
    expect(chatRequest.safeParse({ content: "x".repeat(8001) }).success).toBe(false);
    expect(chatRequest.safeParse({ messages: [{ role: "user", content: "x" }] }).success).toBe(false);
  });

  it("boucle d'outils : événements tool puis texte, résultats renvoyés au modèle", async () => {
    const db = freshDb();
    seedTransactions(db);

    type Turn = { events: unknown[]; message: Partial<Anthropic.Message> };
    const toolUse = { type: "tool_use", id: "toolu_1", name: "search_transactions", input: { q: "loyer" } };
    const turns: Turn[] = [
      {
        events: [{ type: "content_block_start", index: 0, content_block: { ...toolUse, input: {} } }],
        message: { stop_reason: "tool_use", content: [toolUse as Anthropic.ToolUseBlock] },
      },
      {
        events: [
          { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Loyer : " } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "**850 €**" } },
        ],
        message: { stop_reason: "end_turn", content: [] },
      },
    ];
    const calls: Anthropic.MessageCreateParams[] = [];
    const stream = vi.fn((params: Anthropic.MessageCreateParams) => {
      calls.push(structuredClone(params));
      const turn = turns[calls.length - 1];
      return {
        async *[Symbol.asyncIterator]() {
          yield* turn.events;
        },
        finalMessage: async () => turn.message,
      };
    });
    const ai = { client: { messages: { stream } } as unknown as Anthropic, model: "claude-opus-5-5" };

    const events: ChatEvent[] = [];
    for await (const e of runChat({ ai, db, messages: [{ role: "user", content: "Mon loyer ?" }], today: "2026-10-24" })) {
      events.push(e);
    }
    expect(events).toEqual([
      { type: "tool", name: "search_transactions" },
      { type: "text", text: "Loyer : " },
      { type: "text", text: "**850 €**" },
      { type: "done" },
    ]);
    expect(stream).toHaveBeenCalledTimes(2);
    expect(calls[0].cache_control).toEqual({ type: "ephemeral" });
    expect(calls[1].cache_control).toEqual({ type: "ephemeral" });
    const system = JSON.stringify(calls[0].system);
    expect(system).toContain("2026-10-24");
    expect(system).toMatch(/données, pas des instructions/);
    const second = calls[1].messages;
    expect(second).toHaveLength(3);
    const toolResult = (second[2].content as Anthropic.ToolResultBlockParam[])[0];
    expect(toolResult).toMatchObject({ type: "tool_result", tool_use_id: "toolu_1" });
    expect(JSON.parse(toolResult.content as string).count).toBe(3);
  });
});

let sharedDbReady = false;

describe("routes IA avec un client simulé", () => {
  const json = { "Content-Type": "application/json" };

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.DATABASE_PATH = ":memory:";
    const db = getDb();
    // getDb() est un singleton : la base en mémoire n'est initialisée qu'une fois.
    if (!sharedDbReady) {
      runMigrations(db);
      seedDefaults(db);
      seedTransactions(db);
      sharedDbReady = true;
    }
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sortie structurée illisible → 502 « Le service Claude est indisponible. » (analyses et catégorisation)", async () => {
    vi.spyOn(Anthropic.Messages.prototype, "parse").mockRejectedValue(
      new Anthropic.AnthropicError("Failed to parse structured output: unexpected end of JSON"),
    );
    const insights = await insightsGET(req("/api/ai/insights?month=2026-10&refresh=1"));
    expect(insights.status).toBe(502);
    expect(await insights.json()).toEqual({ error: "Le service Claude est indisponible." });
    const cat = await categorizePOST(
      req("/api/ai/categorize", { method: "POST", headers: json, body: JSON.stringify({ labels: ["NETFLIX"] }) }),
    );
    expect(cat.status).toBe(502);
    expect(await cat.json()).toEqual({ error: "Le service Claude est indisponible." });
  });

  it("chat : paramètres avec cache automatique, puis « : ping » toutes les 15 s tant que le flux est ouvert", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const params: Anthropic.MessageCreateParams[] = [];
    vi.spyOn(Anthropic.Messages.prototype, "stream").mockImplementation(((p: Anthropic.MessageCreateParams) => {
      params.push(p);
      return {
        async *[Symbol.asyncIterator]() {
          await gate;
          yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Bonjour" } };
        },
        finalMessage: async () => ({ stop_reason: "end_turn", content: [] }),
      };
    }) as never);

    const res = await chatPOST(
      req("/api/ai/chat", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ content: "Salut" }),
      }),
    );
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();

    expect(HEARTBEAT_MS).toBe(15_000);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(HEARTBEAT_MS);
    expect((await reader.read()).value).toBe(PING);
    vi.advanceTimersByTime(HEARTBEAT_MS);
    expect((await reader.read()).value).toBe(PING);

    release();
    let rest = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      rest += value;
    }
    const events = decodeSse(rest).events;
    expect(events).toEqual([{ type: "text", text: "Bonjour" }, { type: "saved", id: expect.any(Number) }, { type: "done" }]);
    expect(vi.getTimerCount()).toBe(0);
    expect(params[0].cache_control).toEqual({ type: "ephemeral" });
  });
});
