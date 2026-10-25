import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { createDb, getDb } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { seedDefaults } from "@/lib/db/seed";
import { messages as messagesTable } from "@/lib/db/schema";
import { addMessage, listMessages, type Message } from "@/lib/queries/messages";
import { getModelSetting, setModelSetting } from "@/lib/settings";
import type { Ai } from "@/lib/ai/client";
import { decodeSse, type ChatEvent } from "@/lib/sse";
import { withGenerationLock } from "@/lib/assistant/lock";
import { dispatch, registerChannel } from "@/lib/assistant/dispatch";
import {
  MODEL_UNAVAILABLE_MESSAGE,
  ModelUnavailableError,
  postAssistantMessage,
  respond,
} from "@/lib/assistant/conversation";
import { POST as chatPOST } from "@/app/api/ai/chat/route";
import { GET as messagesGET } from "@/app/api/messages/route";
import { GET as unreadGET } from "@/app/api/messages/unread/route";
import { POST as readPOST } from "@/app/api/messages/read/route";
import { POST as dividerPOST } from "@/app/api/messages/divider/route";

function freshDb() {
  const db = createDb(":memory:");
  runMigrations(db);
  seedDefaults(db);
  return db;
}

type TestDb = ReturnType<typeof freshDb>;

function req(url: string, init?: RequestInit) {
  return new Request(`http://localhost${url}`, init);
}

const json = { "Content-Type": "application/json" };

type Turn = {
  texts: string[];
  stop?: Anthropic.Message["stop_reason"];
  gate?: Promise<void>;
  error?: unknown;
  onFinal?: () => void;
};

/** Client simulé : chaque appel à `stream` consomme le tour suivant. */
function fakeAi(turns: Turn[]) {
  const calls: Anthropic.MessageCreateParams[] = [];
  const stream = vi.fn((params: Anthropic.MessageCreateParams, opts?: { signal?: AbortSignal }) => {
    calls.push(structuredClone(params));
    const turn = turns[calls.length - 1] ?? { texts: ["(défaut)"] };
    return {
      async *[Symbol.asyncIterator]() {
        if (turn.error) throw turn.error;
        for (const text of turn.texts) {
          if (opts?.signal?.aborted) throw new Anthropic.APIUserAbortError();
          yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } };
          if (turn.gate) await turn.gate;
        }
        if (opts?.signal?.aborted) throw new Anthropic.APIUserAbortError();
      },
      finalMessage: async () => {
        turn.onFinal?.();
        return { stop_reason: turn.stop ?? "end_turn", content: [] };
      },
    };
  });
  const ai = { client: { messages: { stream } } as unknown as Anthropic, model: "claude-opus-5-5" } satisfies Ai;
  return { ai, calls, stream };
}

function userMessage(db: TestDb, content: string, source: "app" | "telegram" = "app") {
  return addMessage(db, { role: "user", kind: "chat", content, source });
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  vi.restoreAllMocks();
});

function channel(name: string, send: (m: Message) => Promise<void>) {
  cleanups.push(registerChannel(name, send));
}

describe("withGenerationLock", () => {
  it("exécute en série, dans l'ordre d'arrivée", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const a = withGenerationLock(async () => {
      order.push("a:start");
      await gate;
      order.push("a:end");
      return "a";
    });
    const b = withGenerationLock(async () => {
      order.push("b:start");
      return "b";
    });
    await Promise.resolve();
    expect(order).toEqual(["a:start"]);
    release();
    expect(await Promise.all([a, b])).toEqual(["a", "b"]);
    expect(order).toEqual(["a:start", "a:end", "b:start"]);
  });

  it("un échec ne bloque pas la file", async () => {
    const failed = withGenerationLock(async () => {
      throw new Error("boom");
    });
    const next = withGenerationLock(async () => 42);
    await expect(failed).rejects.toThrow("boom");
    expect(await next).toBe(42);
  });
});

describe("état partagé entre exemplaires du module", () => {
  it("registre des canaux et verrou communs après rechargement des modules", async () => {
    vi.resetModules();
    const d1 = await import("@/lib/assistant/dispatch");
    const l1 = await import("@/lib/assistant/lock");
    vi.resetModules();
    const d2 = await import("@/lib/assistant/dispatch");
    const l2 = await import("@/lib/assistant/lock");
    expect(d2).not.toBe(d1);

    const db = freshDb();
    const m = addMessage(db, { role: "assistant", kind: "alert", content: "x", source: "system" });
    const send = vi.fn(async () => {});
    cleanups.push(d1.registerChannel("shared-test", send));
    await d2.dispatch(m);
    expect(send).toHaveBeenCalledWith(m);

    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const a = l1.withGenerationLock(async () => {
      await gate;
      order.push("a");
    });
    const b = l2.withGenerationLock(async () => {
      order.push("b");
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(order).toEqual([]);
    release();
    await Promise.all([a, b]);
    expect(order).toEqual(["a", "b"]);
  });
});

describe("dispatch", () => {
  it("appelle tous les canaux sauf `except`, journalise les échecs sans les propager", async () => {
    const db = freshDb();
    const m = addMessage(db, { role: "assistant", kind: "alert", content: "secret", source: "system" });
    const app = vi.fn(async () => {});
    const tg = vi.fn(async () => {
      throw new Error("réseau");
    });
    channel("app-test", app);
    channel("tg-test", tg);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await dispatch(m);
    expect(app).toHaveBeenCalledWith(m);
    expect(tg).toHaveBeenCalledWith(m);
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");

    await dispatch(m, { except: "tg-test" });
    expect(app).toHaveBeenCalledTimes(2);
    expect(tg).toHaveBeenCalledTimes(1);
  });

  it("même nom → remplace ; la fonction retournée désinscrit", async () => {
    const db = freshDb();
    const m = addMessage(db, { role: "assistant", kind: "alert", content: "x", source: "system" });
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});
    registerChannel("dup-test", first);
    const unregister = registerChannel("dup-test", second);
    await dispatch(m);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    unregister();
    await dispatch(m);
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("postAssistantMessage", () => {
  it("enregistre (source system) puis diffuse à tous les canaux", async () => {
    const db = freshDb();
    const sent = vi.fn(async () => {});
    channel("post-test", sent);
    const m = await postAssistantMessage(db, { kind: "alert", content: "Budget dépassé", meta: { level: "warn" } });
    expect(m).toMatchObject({ role: "assistant", kind: "alert", source: "system", content: "Budget dépassé" });
    expect(m.meta).toEqual({ level: "warn" });
    expect(listMessages(db).map((x) => x.id)).toEqual([m.id]);
    expect(sent).toHaveBeenCalledWith(m);
  });
});

describe("respond", () => {
  it("persiste la réponse, émet text/saved/done et diffuse sauf vers la source", async () => {
    const db = freshDb();
    userMessage(db, "Bonjour", "telegram");
    const { ai, calls } = fakeAi([{ texts: ["Salut", " !"] }]);
    const tg = vi.fn(async () => {});
    const app = vi.fn(async () => {});
    channel("telegram", tg);
    channel("app", app);
    const events: ChatEvent[] = [];

    const m = await respond(db, { ai, source: "telegram", onEvent: (e) => events.push(e), today: "2026-10-25" });
    expect(m).toMatchObject({ role: "assistant", kind: "chat", source: "telegram", content: "Salut !" });
    expect(events).toEqual([
      { type: "text", text: "Salut" },
      { type: "text", text: " !" },
      { type: "saved", id: m!.id },
      { type: "done" },
    ]);
    expect(tg).not.toHaveBeenCalled();
    expect(app).toHaveBeenCalledWith(m);
    expect(calls[0].messages).toEqual([{ role: "user", content: "Bonjour" }]);
    const system = JSON.stringify(calls[0].system);
    expect(system).toContain("Telegram");
  });

  it("contexte vide → erreur « Aucun message à traiter »", async () => {
    const db = freshDb();
    const { ai } = fakeAi([]);
    await expect(respond(db, { ai, source: "app" })).rejects.toThrow("Aucun message à traiter");
  });

  it("aucun texte → « Je n'ai pas pu répondre. »", async () => {
    const db = freshDb();
    userMessage(db, "?");
    const { ai } = fakeAi([{ texts: [] }]);
    const m = await respond(db, { ai, source: "app" });
    expect(m?.content).toBe("Je n'ai pas pu répondre.");
  });

  it("deux respond simultanés → en série, chacun voit les messages enregistrés avant lui", async () => {
    const db = freshDb();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { ai, calls } = fakeAi([{ texts: ["R1"], gate }, { texts: ["R2"] }]);

    userMessage(db, "Q1");
    const first = respond(db, { ai, source: "app" });
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toHaveLength(1);
    // Message reçu pendant la génération : mis en file.
    userMessage(db, "Q2", "telegram");
    const second = respond(db, { ai, source: "telegram" });
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toHaveLength(1);
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(a?.content).toBe("R1");
    expect(b?.content).toBe("R2");
    expect(calls).toHaveLength(2);
    expect(calls[0].messages).toEqual([{ role: "user", content: "Q1" }]);
    // Le second voit R1 (enregistré par le premier) avant Q2.
    expect(calls[1].messages).toEqual([
      { role: "user", content: "Q1" },
      { role: "assistant", content: "R1" },
      { role: "user", content: "Q2" },
    ]);
    // Le fil garde l'ordre d'arrivée ; chaque réponse indique le message traité.
    const thread = listMessages(db);
    expect(thread.map((x) => `${x.role}:${x.content}`)).toEqual(["user:Q1", "user:Q2", "assistant:R1", "assistant:R2"]);
    expect(thread[2].meta).toEqual({ replyTo: thread[0].id });
    expect(thread[3].meta).toEqual({ replyTo: thread[1].id });
  });

  it("question suivie d'une alerte → la question reste en fin de contexte", async () => {
    const db = freshDb();
    userMessage(db, "Q");
    addMessage(db, { role: "assistant", kind: "alert", content: "Alerte", source: "system" });
    const { ai, calls } = fakeAi([{ texts: ["R"] }]);
    expect((await respond(db, { ai, source: "app" }))?.content).toBe("R");
    // L'alerte, désormais en tête, est retirée (le contexte commence par l'utilisateur).
    expect(calls[0].messages).toEqual([{ role: "user", content: "Q" }]);
  });

  it("dernier message déjà répondu → null sans appeler le modèle", async () => {
    const db = freshDb();
    userMessage(db, "Q");
    addMessage(db, { role: "assistant", kind: "chat", content: "R", source: "app" });
    const { ai, stream } = fakeAi([{ texts: ["x"] }]);
    expect(await respond(db, { ai, source: "app" })).toBeNull();
    expect(stream).not.toHaveBeenCalled();
  });

  it("abort après du texte → texte partiel + « (interrompu) » ; abort sans texte → rien", async () => {
    const db = freshDb();
    userMessage(db, "Long ?");
    const controller = new AbortController();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { ai } = fakeAi([{ texts: ["Début", " suite"], gate }]);
    const pending = respond(db, {
      ai,
      source: "app",
      signal: controller.signal,
      onEvent: (e) => {
        if (e.type === "text") {
          controller.abort();
          release();
        }
      },
    });
    const m = await pending;
    expect(m?.content).toBe("Début\n\n_(interrompu)_");

    const before = listMessages(db).length;
    const c2 = new AbortController();
    c2.abort();
    const { ai: ai2 } = fakeAi([{ texts: ["x"] }]);
    expect(await respond(db, { ai: ai2, source: "app", signal: c2.signal })).toBeNull();
    expect(listMessages(db)).toHaveLength(before);
  });

  it("annulation après une fin normale → réponse complète, sans « (interrompu) »", async () => {
    const db = freshDb();
    userMessage(db, "Q");
    const controller = new AbortController();
    const { ai } = fakeAi([{ texts: ["Réponse complète"], onFinal: () => controller.abort() }]);
    const m = await respond(db, { ai, source: "app", signal: controller.signal });
    expect(m?.content).toBe("Réponse complète");
  });

  it("modèle introuvable → réglage effacé + erreur française", async () => {
    const db = freshDb();
    setModelSetting(db, "claude-retired-1");
    userMessage(db, "Salut");
    const notFound = Anthropic.APIError.generate(
      404,
      { type: "error", error: { type: "not_found_error", message: "model: claude-retired-1" } },
      "m",
      new Headers(),
    );
    const { ai } = fakeAi([{ texts: [], error: notFound }]);
    const err = await respond(db, { ai, source: "app" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelUnavailableError);
    expect((err as Error).message).toBe("Le modèle choisi n'est plus disponible ; modèle par défaut rétabli.");
    expect(MODEL_UNAVAILABLE_MESSAGE).toBe((err as Error).message);
    expect(getModelSetting(db)).toBeNull();
    expect(listMessages(db).filter((m) => m.role === "assistant")).toHaveLength(0);
  });
});

describe("routes du fil", () => {
  const ENV_KEYS = ["ANTHROPIC_API_KEY", "CLAUDE_MODEL"] as const;
  let savedEnv: Record<string, string | undefined>;
  let ready = false;

  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
    const db = getDb();
    if (!ready) {
      runMigrations(db);
      seedDefaults(db);
      ready = true;
    }
    db.delete(messagesTable).run();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  function postChat(body: unknown) {
    return chatPOST(req("/api/ai/chat", { method: "POST", headers: json, body: JSON.stringify(body) }));
  }

  async function readAll(res: Response) {
    return decodeSse(await res.text()).events;
  }

  it("chat sans clé → 503, rien n'est enregistré", async () => {
    const res = await postChat({ content: "Bonjour" });
    expect(res.status).toBe(503);
    expect(listMessages(getDb())).toHaveLength(0);
  });

  it("chat : 400 si vide, trop long ou ancien format", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    for (const body of [{ content: "   " }, { content: "x".repeat(8001) }, { messages: [{ role: "user", content: "x" }] }]) {
      expect((await postChat(body)).status).toBe(400);
    }
    expect(listMessages(getDb())).toHaveLength(0);
  });

  it("chat : enregistre le message user puis la réponse, événement saved puis done", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    vi.spyOn(Anthropic.Messages.prototype, "stream").mockImplementation((() => ({
      async *[Symbol.asyncIterator]() {
        yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Bonjour" } };
      },
      finalMessage: async () => ({ stop_reason: "end_turn", content: [] }),
    })) as never);

    const res = await postChat({ content: "  Salut  " });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = await readAll(res);
    const thread = listMessages(getDb());
    expect(thread.map((m) => [m.role, m.source, m.content])).toEqual([
      ["user", "app", "Salut"],
      ["assistant", "app", "Bonjour"],
    ]);
    expect(events).toEqual([
      { type: "text", text: "Bonjour" },
      { type: "saved", id: thread[1].id },
      { type: "done" },
    ]);
  });

  it("chat retry : aucune question enregistrée, la question en attente reçoit sa réponse", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const db = getDb();
    const question = addMessage(db, { role: "user", kind: "chat", content: "Question restée sans réponse", source: "app" });
    vi.spyOn(Anthropic.Messages.prototype, "stream").mockImplementation((() => ({
      async *[Symbol.asyncIterator]() {
        yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Réponse" } };
      },
      finalMessage: async () => ({ stop_reason: "end_turn", content: [] }),
    })) as never);

    const events = await readAll(await postChat({ retry: true }));
    const thread = listMessages(db);
    expect(thread.map((m) => [m.role, m.content])).toEqual([
      ["user", "Question restée sans réponse"],
      ["assistant", "Réponse"],
    ]);
    expect(thread[1].meta).toEqual({ replyTo: question.id });
    expect(events).toEqual([
      { type: "text", text: "Réponse" },
      { type: "saved", id: thread[1].id },
      { type: "done" },
    ]);
  });

  it("chat retry : rien en attente → seulement done, sans appel au modèle", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const db = getDb();
    const q = addMessage(db, { role: "user", kind: "chat", content: "Q", source: "app" });
    addMessage(db, { role: "assistant", kind: "chat", content: "R", source: "app", meta: { replyTo: q.id } });
    const stream = vi.spyOn(Anthropic.Messages.prototype, "stream");
    const events = await readAll(await postChat({ retry: true }));
    expect(events).toEqual([{ type: "done" }]);
    expect(stream).not.toHaveBeenCalled();
    expect(listMessages(db)).toHaveLength(2);
  });

  it("chat retry : 400 si retry n'est pas true", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    for (const body of [{ retry: false }, { retry: "oui" }, {}]) {
      expect((await postChat(body)).status).toBe(400);
    }
  });

  it("chat : modèle introuvable → événement error français, réglage effacé", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    setModelSetting(getDb(), "claude-retired-1");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(Anthropic.Messages.prototype, "stream").mockImplementation((() => ({
      async *[Symbol.asyncIterator]() {
        throw Anthropic.APIError.generate(
          404,
          { type: "error", error: { type: "not_found_error", message: "model" } },
          "m",
          new Headers(),
        );
      },
      finalMessage: async () => ({ stop_reason: "end_turn", content: [] }),
    })) as never);
    const events = await readAll(await postChat({ content: "Salut" }));
    expect(events).toEqual([{ type: "error", error: MODEL_UNAVAILABLE_MESSAGE }]);
    expect(getModelSetting(getDb())).toBeNull();
  });

  it("chat : divider inséré pendant l'attente du verrou → événement error « Aucun message à traiter », sans journal", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const stream = vi.spyOn(Anthropic.Messages.prototype, "stream");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const held = withGenerationLock(() => gate);
    const res = await postChat({ content: "Salut" });
    const body = res.text();
    addMessage(getDb(), { role: "divider", kind: "divider", content: "", source: "app" });
    release();
    await held;
    expect(decodeSse(await body).events).toEqual([{ type: "error", error: "Aucun message à traiter" }]);
    expect(log).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
  });

  it("GET /api/messages : pagination et validation", async () => {
    const db = getDb();
    const ids = ["a", "b", "c"].map((c) => userMessage(db as TestDb, c).id);
    const all = await (await messagesGET(req("/api/messages"))).json();
    expect(all.messages.map((m: Message) => m.content)).toEqual(["a", "b", "c"]);
    const page = await (await messagesGET(req(`/api/messages?before=${ids[2]}&limit=1`))).json();
    expect(page.messages.map((m: Message) => m.content)).toEqual(["b"]);
    for (const q of ["?limit=0", "?limit=201", "?before=abc", "?before=-1", "?limit=1.5"]) {
      expect((await messagesGET(req(`/api/messages${q}`))).status).toBe(400);
    }
  });

  it("unread, read (ids / all) et divider", async () => {
    const db = getDb();
    const a = addMessage(db, { role: "assistant", kind: "alert", content: "A", source: "system" });
    const b = addMessage(db, { role: "assistant", kind: "weekly", content: "B", source: "system" });
    const unread = await (await unreadGET()).json();
    expect(unread.count).toBe(2);
    expect(unread.latest).toHaveLength(2);

    const post = (body: unknown) =>
      readPOST(req("/api/messages/read", { method: "POST", headers: json, body: JSON.stringify(body) }));
    expect(await (await post({ ids: [a.id] })).json()).toEqual({ updated: 1 });
    expect((await (await unreadGET()).json()).count).toBe(1);
    expect(await (await post({ all: true })).json()).toEqual({ updated: 1 });
    expect((await (await unreadGET()).json()).count).toBe(0);
    for (const bad of [{}, { ids: [] }, { all: false }, { ids: Array.from({ length: 201 }, (_, i) => i + 1) }, { ids: ["x"] }]) {
      expect((await post(bad)).status).toBe(400);
    }
    expect(b.id).toBeGreaterThan(a.id);

    const res = await dividerPOST();
    expect(res.status).toBe(201);
    const { message } = await res.json();
    expect(message).toMatchObject({ role: "divider", kind: "divider" });
    expect(listMessages(db).at(-1)?.id).toBe(message.id);
  });
});
