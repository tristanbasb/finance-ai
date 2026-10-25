import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { createDb, getDb } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { seedDefaults } from "@/lib/db/seed";
import { effectiveModel, getAi, isModelNotFound, type Ai } from "@/lib/ai/client";
import { FALLBACK_MODELS, listModels, modelSupports, resetModelsCache } from "@/lib/ai/models";
import { categorize } from "@/lib/ai/categorize";
import { getModelSetting, setModelSetting } from "@/lib/settings";
import { GET as modelsGET } from "@/app/api/ai/models/route";
import { GET as statusGET } from "@/app/api/ai/status/route";
import { PUT as modelPUT } from "@/app/api/settings/model/route";

function freshDb() {
  const db = createDb(":memory:");
  runMigrations(db);
  seedDefaults(db);
  return db;
}

const ENV_KEYS = ["ANTHROPIC_API_KEY", "CLAUDE_MODEL", "DATABASE_PATH"] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  resetModelsCache();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.restoreAllMocks();
});

type Info = { id: string; display_name?: string; created_at?: string };
function listClient(items: Info[] | (() => never)) {
  const list = vi.fn(() => {
    if (typeof items === "function") return items();
    return (async function* () {
      for (const i of items) yield i;
    })();
  });
  const ai = { client: { models: { list } } as unknown as Anthropic, model: "claude-opus-5-5" } satisfies Ai;
  return { ai, list };
}

const SAMPLE: Info[] = [
  { id: "claude-haiku-5-5", display_name: "Claude Haiku 5.5", created_at: "2026-09-01T00:00:00Z" },
  { id: "claude-opus-5", display_name: "Claude Opus 5", created_at: "2026-06-01T00:00:00Z" },
  { id: "other-model", display_name: "Autre" },
  { id: "claude-opus-5-5", display_name: "Claude Opus 5.5", created_at: "2026-08-01T00:00:00Z" },
  { id: "claude-sonnet-5-5", created_at: "2026-08-15T00:00:00Z" },
  { id: "claude-zeta-1", display_name: "Zeta", created_at: "2026-01-01T00:00:00Z" },
];

describe("modelSupports", () => {
  it("effort : familles 5.x seulement", () => {
    for (const m of ["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"]) {
      expect(modelSupports(m, "effort")).toBe(true);
    }
    for (const m of ["claude-haiku-4-5", "claude-opus-4-8", "claude-sonnet-4-6", "inconnu", ""]) {
      expect(modelSupports(m, "effort")).toBe(false);
    }
  });
});

describe("listModels", () => {
  it("IA absente → secours sans appel", async () => {
    expect(await listModels(null)).toBe(FALLBACK_MODELS);
    expect(FALLBACK_MODELS.map((m) => m.name)).toEqual([
      "Claude Opus 5.5",
      "Claude Sonnet 5.5",
      "Claude Haiku 5.5",
      "Claude Fable 5.1",
    ]);
  });

  it("filtre claude-*, trie par famille puis récence, nom = display_name ou id", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-a";
    const { ai, list } = listClient(SAMPLE);
    expect(await listModels(ai)).toEqual([
      { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
      { id: "claude-opus-5", name: "Claude Opus 5" },
      { id: "claude-sonnet-5-5", name: "claude-sonnet-5-5" },
      { id: "claude-haiku-5-5", name: "Claude Haiku 5.5" },
      { id: "claude-zeta-1", name: "Zeta" },
    ]);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("cache 24 h par clé", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-a";
    const { ai, list } = listClient(SAMPLE);
    const t = 1_000_000;
    await listModels(ai, t);
    await listModels(ai, t + 23 * 3600_000);
    expect(list).toHaveBeenCalledTimes(1);
    await listModels(ai, t + 25 * 3600_000);
    expect(list).toHaveBeenCalledTimes(2);
    process.env.ANTHROPIC_API_KEY = "sk-ant-b";
    await listModels(ai, t + 25 * 3600_000 + 1);
    expect(list).toHaveBeenCalledTimes(3);
  });

  it("erreur ou liste vide → secours, non mis en cache", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-a";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = listClient(() => {
      throw new Error("réseau");
    });
    expect(await listModels(bad.ai)).toBe(FALLBACK_MODELS);
    const ok = listClient(SAMPLE);
    expect((await listModels(ok.ai)).length).toBe(5);
    expect(await listModels(listClient([{ id: "x" }]).ai, Date.now() + 99 * 3600_000)).toBe(FALLBACK_MODELS);
  });
});

describe("modèle effectif", () => {
  it("réglage > CLAUDE_MODEL > défaut", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-a";
    const db = freshDb();
    expect(getAi(db)?.model).toBe("claude-opus-5-5");
    process.env.CLAUDE_MODEL = "claude-haiku-5-5";
    expect(getAi(db)?.model).toBe("claude-haiku-5-5");
    setModelSetting(db, "claude-sonnet-5-5");
    expect(getAi(db)?.model).toBe("claude-sonnet-5-5");
    expect(effectiveModel(db)).toBe("claude-sonnet-5-5");
  });

  it("base non migrée → repli sur l'environnement", () => {
    const raw = createDb(":memory:");
    process.env.CLAUDE_MODEL = "claude-haiku-5-5";
    expect(effectiveModel(raw)).toBe("claude-haiku-5-5");
  });
});

describe("isModelNotFound", () => {
  it("404 not_found_error", () => {
    const e = Anthropic.APIError.generate(
      404,
      { type: "error", error: { type: "not_found_error", message: "model: x" } },
      "m",
      new Headers(),
    );
    expect(isModelNotFound(e)).toBe(true);
    const e500 = Anthropic.APIError.generate(
      500,
      { type: "error", error: { type: "api_error", message: "m" } },
      "m",
      new Headers(),
    );
    expect(isModelNotFound(e500)).toBe(false);
    expect(isModelNotFound(new Error("x"))).toBe(false);
  });
});

describe("categorize et effort", () => {
  type Call = [{ output_config: Record<string, unknown> }];
  function parseClient(model: string) {
    const parse = vi.fn(async () => ({ parsed_output: { results: [] }, stop_reason: "end_turn", content: [] }));
    return { parse, ai: { client: { messages: { parse } } as unknown as Anthropic, model } satisfies Ai };
  }
  const cats = [{ id: 1, name: "A", kind: "expense" as const }];

  it("envoie effort pour un modèle supporté", async () => {
    const { ai, parse } = parseClient("claude-opus-5-5");
    await categorize(["x"], cats, ai);
    expect((parse.mock.calls[0] as unknown as Call)[0].output_config.effort).toBe("low");
  });

  it("n'envoie pas effort pour un modèle non supporté", async () => {
    const { ai, parse } = parseClient("claude-haiku-4-5");
    await categorize(["x"], cats, ai);
    const cfg = (parse.mock.calls[0] as unknown as Call)[0].output_config;
    expect("effort" in cfg).toBe(false);
    expect(cfg.format).toBeDefined();
  });
});

describe("routes modèle", () => {
  function put(body: unknown) {
    return modelPUT(new Request("http://localhost/api/settings/model", { method: "PUT", body: JSON.stringify(body) }));
  }

  it("GET /api/ai/models sans IA → secours + modèle effectif", async () => {
    process.env.DATABASE_PATH = ":memory:";
    runMigrations(getDb());
    const res = await modelsGET();
    expect(await res.json()).toEqual({ models: FALLBACK_MODELS, current: "claude-opus-5-5" });
  });

  it("PUT refuse un id inconnu, accepte un id listé, et le statut le reflète", async () => {
    process.env.DATABASE_PATH = ":memory:";
    const db = getDb();
    runMigrations(db);
    const bad = await put({ model: "claude-nimporte-quoi" });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "Modèle inconnu" });
    expect((await put({})).status).toBe(400);
    expect(getModelSetting(db)).toBeNull();

    const ok = await put({ model: "claude-haiku-5-5" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ model: "claude-haiku-5-5" });
    expect(getModelSetting(db)).toBe("claude-haiku-5-5");
    expect(await (await statusGET()).json()).toEqual({ enabled: false, model: "claude-haiku-5-5" });
    setModelSetting(db, null);
  });
});
