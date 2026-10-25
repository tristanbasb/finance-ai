import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { createDb, getDb } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { seedDefaults } from "@/lib/db/seed";
import { messages as messagesTable } from "@/lib/db/schema";
import { addMessage, listMessages, type Message } from "@/lib/queries/messages";
import { getModelSetting, getSetting, setSetting } from "@/lib/settings";
import type { Ai } from "@/lib/ai/client";
import { systemPrompt } from "@/lib/ai/chat";
import { dispatch } from "@/lib/assistant/dispatch";
import { ModelUnavailableError, respond } from "@/lib/assistant/conversation";
import { resetBotUsernameCache, telegramApi, TelegramError, type TelegramApi, type TelegramUpdate } from "@/lib/telegram/api";
import { splitMessage, toTelegramHtml } from "@/lib/telegram/format";
import {
  CHAT_ID_KEY,
  createLinkCode,
  LINK_CODE_KEY,
  LINK_CODE_TTL_MS,
  linkChat,
  linkedChatId,
  unlinkTelegram,
} from "@/lib/telegram/link";
import {
  AI_DISABLED_TELEGRAM_MESSAGE,
  BILAN_PROMPT,
  createBotContext,
  handleUpdate,
  NON_TEXT_MESSAGE,
  PRIVATE_MESSAGE,
  startBot,
  TELEGRAM_HINT,
  TOO_LONG_MESSAGE,
  type BotContext,
} from "@/lib/telegram/bot";
import { DELETE as linkDELETE, POST as linkPOST } from "@/app/api/telegram/link/route";
import { GET as statusGET } from "@/app/api/telegram/status/route";

const TOKEN = "123456:SECRET-token_abc";

function freshDb() {
  const db = createDb(":memory:");
  runMigrations(db);
  seedDefaults(db);
  return db;
}
type TestDb = ReturnType<typeof freshDb>;

type Sent = { chatId: string; text: string; plain: boolean };

/** API Telegram simulée : enregistre les envois ; `failHtml` refuse le HTML (400). */
function fakeApi(opts: { failHtml?: boolean } = {}) {
  const sent: Sent[] = [];
  const actions: string[] = [];
  const api: TelegramApi = {
    getMe: vi.fn(async () => ({ id: 1, username: "finance_bot" })),
    getUpdates: vi.fn(async () => []),
    sendMessage: vi.fn(async (chatId: string, text: string, o?: { plain?: boolean }) => {
      if (opts.failHtml && !o?.plain) {
        throw new TelegramError("Telegram sendMessage : Bad Request: can't parse entities", 400);
      }
      sent.push({ chatId, text, plain: !!o?.plain });
    }),
    sendChatAction: vi.fn(async (chatId: string) => {
      actions.push(chatId);
    }),
  };
  return { api, sent, actions };
}

let nextUpdateId = 1;
function textUpdate(chatId: number, text: string, type = "private"): TelegramUpdate {
  return { update_id: nextUpdateId++, message: { message_id: 1, chat: { id: chatId, type }, text } };
}

const CHAT = 4242;

function setup(overrides: Partial<Omit<BotContext, "db" | "api">> = {}, apiOpts: { failHtml?: boolean } = {}) {
  const db = freshDb();
  const fake = fakeApi(apiOpts);
  const respondMock = vi.fn(async (d: TestDb) =>
    addMessage(d, { role: "assistant", kind: "chat", content: "Réponse **ok**", source: "telegram" }),
  );
  const ai = { client: {} as Anthropic, model: "claude-opus-5-5" } satisfies Ai;
  const ctx = createBotContext(db, fake.api, {
    getAi: () => ai,
    respond: respondMock as unknown as BotContext["respond"],
    typingIntervalMs: 5,
    ...overrides,
  });
  return { db, ctx, ...fake, respondMock, ai };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("toTelegramHtml", () => {
  it("échappe & < > et convertit gras, italique, code", () => {
    expect(toTelegramHtml("a < b & c > d <script>")).toBe("a &lt; b &amp; c &gt; d &lt;script&gt;");
    expect(toTelegramHtml("**1 234 €** et *peu* avec `x<y`")).toBe("<b>1 234 €</b> et <i>peu</i> avec <code>x&lt;y</code>");
  });

  it("listes à puces « • », listes numérotées, paragraphes séparés par une ligne vide", () => {
    const html = toTelegramHtml("Intro\n\n- un\n- **deux**\n\n1. a\n2. b\n\nFin");
    expect(html).toBe("Intro\n\n• un\n• <b>deux</b>\n\n1. a\n2. b\n\nFin");
  });

  it("bloc de code en <pre> échappé", () => {
    expect(toTelegramHtml("```\n<a>\n```")).toBe("<pre>&lt;a&gt;</pre>");
  });
});

describe("splitMessage", () => {
  it("texte court : un seul morceau", () => {
    expect(splitMessage("bonjour")).toEqual(["bonjour"]);
  });

  it("coupe aux paragraphes, chaque morceau ≤ max", () => {
    const p = "x".repeat(1500);
    const text = [p, p, p, p].join("\n\n");
    const parts = splitMessage(text, 4000);
    expect(parts.length).toBe(2);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(4000);
    expect(parts.join("\n\n")).toBe(text);
  });

  it("puis aux lignes, puis en dur pour une ligne trop longue", () => {
    const lines = Array.from({ length: 10 }, () => "y".repeat(900)).join("\n");
    const parts = splitMessage(lines, 4000);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(4000);
    expect(parts.join("\n")).toBe(lines);

    const huge = "z".repeat(9000);
    const hard = splitMessage(huge, 4000);
    expect(hard.map((p) => p.length)).toEqual([4000, 4000, 1000]);
  });
});

describe("telegramApi", () => {
  it("appelle la méthode en POST JSON et renvoie result", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ ok: true, result: [{ update_id: 7 }] }));
    const api = telegramApi(TOKEN, fetchMock as unknown as typeof fetch);
    const updates = await api.getUpdates(5, 30);
    expect(updates).toEqual([{ update_id: 7 }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`https://api.telegram.org/bot${TOKEN}/getUpdates`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({ offset: 5, timeout: 30, allowed_updates: ["message"] });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("erreur Telegram → TelegramError avec statut, sans le token", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ ok: false, error_code: 409, description: `Conflict for bot${TOKEN}` }, { status: 409 }),
    );
    const api = telegramApi(TOKEN, fetchMock as unknown as typeof fetch);
    const err = await api.sendMessage("1", "x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TelegramError);
    expect((err as TelegramError).status).toBe(409);
    expect((err as Error).message).not.toContain("SECRET");
  });

  it("erreur réseau : message expurgé du token", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError(`fetch failed https://api.telegram.org/bot${TOKEN}/getMe`);
    });
    const api = telegramApi(TOKEN, fetchMock as unknown as typeof fetch);
    const err = await api.getMe().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TelegramError);
    expect((err as Error).message).not.toContain("SECRET");
  });

  it("sendMessage : HTML par défaut, texte brut avec plain", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ ok: true, result: {} }));
    const api = telegramApi(TOKEN, fetchMock as unknown as typeof fetch);
    await api.sendMessage("9", "<b>x</b>");
    await api.sendMessage("9", "x", { plain: true });
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies[0]).toMatchObject({ chat_id: "9", text: "<b>x</b>", parse_mode: "HTML" });
    expect(bodies[1].parse_mode).toBeUndefined();
  });
});

describe("liaison", () => {
  it("code valide → chat relié, code consommé, confirmation", async () => {
    const { db, ctx, sent } = setup();
    const { code, expiresAt } = createLinkCode(db);
    expect(code).toMatch(/^\d{6}$/);
    expect(expiresAt - Date.now()).toBeGreaterThan(LINK_CODE_TTL_MS - 5000);
    await handleUpdate(ctx, textUpdate(CHAT, `/start ${code}`));
    expect(linkedChatId(db)).toBe(String(CHAT));
    expect(getSetting(db, LINK_CODE_KEY, (await import("zod")).z.unknown(), null)).toBeNull();
    expect(sent[0].text).toContain("relié");
  });

  it("code expiré ou faux → non relié", async () => {
    const { db, ctx, sent } = setup();
    setSetting(db, LINK_CODE_KEY, { code: "123456", expiresAt: Date.now() - 1 });
    await handleUpdate(ctx, textUpdate(CHAT, "/start 123456"));
    expect(linkedChatId(db)).toBeNull();
    const { code } = createLinkCode(db);
    const wrong = code === "000000" ? "000001" : "000000";
    await handleUpdate(ctx, textUpdate(CHAT, `/start ${wrong}`));
    expect(linkedChatId(db)).toBeNull();
    expect(sent.every((s) => !s.text.includes("relié"))).toBe(true);
  });

  it("après 5 codes faux, les /start sont ignorés 10 minutes", async () => {
    let now = Date.now();
    const { db, ctx, sent } = setup({ now: () => now });
    const { code } = createLinkCode(db, now);
    const wrong = code === "000000" ? "000001" : "000000";
    for (let i = 0; i < 5; i++) await handleUpdate(ctx, textUpdate(1000 + i, `/start ${wrong}`));
    const before = sent.length;
    await handleUpdate(ctx, textUpdate(CHAT, `/start ${code}`));
    expect(linkedChatId(db)).toBeNull();
    expect(sent.length).toBe(before);
    now += 10 * 60_000 + 1;
    const fresh = createLinkCode(db, now);
    await handleUpdate(ctx, textUpdate(CHAT, `/start ${fresh.code}`));
    expect(linkedChatId(db)).toBe(String(CHAT));
  });
});

describe("handleUpdate", () => {
  it("chat inconnu → « Ce bot est privé. » (une fois par heure), aucune donnée touchée", async () => {
    const { db, ctx, sent, respondMock } = setup();
    linkChat(db, String(CHAT));
    await handleUpdate(ctx, textUpdate(999, "Quel est mon solde ?"));
    await handleUpdate(ctx, textUpdate(999, "Allô ?"));
    expect(sent).toEqual([{ chatId: "999", text: PRIVATE_MESSAGE, plain: false }]);
    expect(listMessages(db)).toHaveLength(0);
    expect(respondMock).not.toHaveBeenCalled();
  });

  it("groupes, messages modifiés et canaux ignorés", async () => {
    const { db, ctx, sent } = setup();
    linkChat(db, String(CHAT));
    await handleUpdate(ctx, textUpdate(CHAT, "salut", "group"));
    await handleUpdate(ctx, { update_id: nextUpdateId++, edited_message: { message_id: 1, chat: { id: CHAT, type: "private" }, text: "x" } });
    await handleUpdate(ctx, { update_id: nextUpdateId++, channel_post: { message_id: 1, chat: { id: CHAT, type: "channel" }, text: "x" } });
    expect(sent).toHaveLength(0);
    expect(listMessages(db)).toHaveLength(0);
  });

  it("sticker → réponse texte, rien d'enregistré", async () => {
    const { db, ctx, sent } = setup();
    linkChat(db, String(CHAT));
    await handleUpdate(ctx, { update_id: nextUpdateId++, message: { message_id: 1, chat: { id: CHAT, type: "private" }, sticker: { file_id: "a" } } });
    expect(sent.map((s) => s.text)).toEqual([NON_TEXT_MESSAGE]);
    expect(listMessages(db)).toHaveLength(0);
  });

  it("texte trop long → refusé, non enregistré", async () => {
    const { db, ctx, sent, respondMock } = setup();
    linkChat(db, String(CHAT));
    await handleUpdate(ctx, textUpdate(CHAT, "a".repeat(8001)));
    expect(sent.map((s) => s.text)).toEqual([TOO_LONG_MESSAGE]);
    expect(listMessages(db)).toHaveLength(0);
    expect(respondMock).not.toHaveBeenCalled();
  });

  it("/modele claude-sonnet-5-5 change le réglage ; id inconnu refusé", async () => {
    const { db, ctx, sent } = setup({ getAi: () => null });
    linkChat(db, String(CHAT));
    await handleUpdate(ctx, textUpdate(CHAT, "/modele claude-sonnet-5-5"));
    expect(getModelSetting(db)).toBe("claude-sonnet-5-5");
    await handleUpdate(ctx, textUpdate(CHAT, "/modele gpt-4"));
    expect(getModelSetting(db)).toBe("claude-sonnet-5-5");
    await handleUpdate(ctx, textUpdate(CHAT, "/modele"));
    const list = sent[sent.length - 1].text;
    expect(list).toContain("claude-sonnet-5-5");
    expect(list).toContain("claude-opus-5-5");
  });

  it("texte → message enregistré (telegram), typing, réponse découpée si > 4000", async () => {
    const long = Array.from({ length: 3 }, (_, i) => `${i} ${"m".repeat(2500)}`).join("\n\n");
    const { db, ctx, sent, actions } = setup({
      respond: (async (d: TestDb, opts: { source: string; channel?: string }) => {
        expect(opts).toMatchObject({ source: "telegram", channel: "telegram" });
        await new Promise((r) => setTimeout(r, 30));
        return addMessage(d, { role: "assistant", kind: "chat", content: long, source: "telegram" });
      }) as unknown as BotContext["respond"],
    });
    linkChat(db, String(CHAT));
    await handleUpdate(ctx, textUpdate(CHAT, "Mon solde <b> ?"));
    const thread = listMessages(db);
    expect(thread[0]).toMatchObject({ role: "user", source: "telegram", content: "Mon solde <b> ?" });
    expect(actions.length).toBeGreaterThanOrEqual(2);
    expect(sent.length).toBe(3);
    for (const s of sent) expect(s.text.length).toBeLessThanOrEqual(4000);
    const calls = actions.length;
    await new Promise((r) => setTimeout(r, 20));
    expect(actions.length).toBe(calls);
  });

  it("réponse null (déjà traitée) → rien envoyé", async () => {
    const { db, ctx, sent } = setup({ respond: (async () => null) as unknown as BotContext["respond"] });
    linkChat(db, String(CHAT));
    await handleUpdate(ctx, textUpdate(CHAT, "salut"));
    expect(sent).toHaveLength(0);
  });

  it("HTML refusé par Telegram → renvoi en texte brut", async () => {
    const { db, ctx, sent } = setup({}, { failHtml: true });
    linkChat(db, String(CHAT));
    await handleUpdate(ctx, textUpdate(CHAT, "salut"));
    expect(sent).toEqual([{ chatId: String(CHAT), text: "Réponse **ok**", plain: true }]);
  });

  it("IA désactivée → message, rien d'enregistré", async () => {
    const { db, ctx, sent, respondMock } = setup({ getAi: () => null });
    linkChat(db, String(CHAT));
    await handleUpdate(ctx, textUpdate(CHAT, "salut"));
    expect(sent.map((s) => s.text)).toEqual([AI_DISABLED_TELEGRAM_MESSAGE]);
    expect(listMessages(db)).toHaveLength(0);
    expect(respondMock).not.toHaveBeenCalled();
  });

  it("erreur de génération → message français", async () => {
    const { db, ctx, sent } = setup({
      respond: (async () => {
        throw new ModelUnavailableError();
      }) as unknown as BotContext["respond"],
    });
    linkChat(db, String(CHAT));
    await handleUpdate(ctx, textUpdate(CHAT, "salut"));
    expect(sent[0].text).toContain("modèle");
  });

  it("/nouveau → séparateur ; /bilan → message utilisateur du bilan puis réponse", async () => {
    const { db, ctx, sent, respondMock } = setup();
    linkChat(db, String(CHAT));
    await handleUpdate(ctx, textUpdate(CHAT, "/nouveau"));
    expect(listMessages(db)[0]).toMatchObject({ role: "divider", kind: "divider", source: "telegram" });
    expect(sent[0].text).toBe("Nouvelle conversation.");
    await handleUpdate(ctx, textUpdate(CHAT, "/bilan"));
    expect(listMessages(db)[1]).toMatchObject({ role: "user", content: BILAN_PROMPT, source: "telegram" });
    expect(respondMock).toHaveBeenCalledTimes(1);
    expect(sent[1].text).toBe("Réponse <b>ok</b>");
  });

  it("/aide, /start déjà relié et commande inconnue → aide", async () => {
    const { db, ctx, sent } = setup();
    linkChat(db, String(CHAT));
    for (const c of ["/aide", "/start", "/inconnue"]) await handleUpdate(ctx, textUpdate(CHAT, c));
    expect(sent).toHaveLength(3);
    for (const s of sent) expect(s.text).toContain("/bilan");
  });
});

describe("conversation réelle sur Telegram", () => {
  it("respond avec channel telegram ajoute la consigne de brièveté au prompt", async () => {
    expect(systemPrompt("2026-10-25").map((b) => b.text).join("\n")).not.toContain(TELEGRAM_HINT);
    expect(systemPrompt("2026-10-25", "telegram").map((b) => b.text).join("\n")).toContain(TELEGRAM_HINT);

    const calls: Anthropic.MessageCreateParams[] = [];
    const stream = vi.fn((params: Anthropic.MessageCreateParams) => {
      calls.push(params);
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Tout va bien." } };
        },
        finalMessage: async () => ({ stop_reason: "end_turn", content: [] }),
      };
    });
    const ai = { client: { messages: { stream } } as unknown as Anthropic, model: "claude-opus-5-5" } satisfies Ai;
    const { db, ctx, sent } = setup({ getAi: () => ai, respond });
    linkChat(db, String(CHAT));
    await handleUpdate(ctx, textUpdate(CHAT, "Ça va ?"));
    const system = calls[0].system as Anthropic.TextBlockParam[];
    expect(system.map((b) => b.text).join("\n")).toContain(TELEGRAM_HINT);
    expect(sent.map((s) => s.text)).toEqual(["Tout va bien."]);
    expect(listMessages(db).map((m) => m.source)).toEqual(["telegram", "telegram"]);
  });
});

describe("startBot", () => {
  const saved = process.env.TELEGRAM_BOT_TOKEN;
  afterEach(() => {
    if (saved === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = saved;
  });

  it("sans token : ne démarre pas", () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const db = freshDb();
    const { api } = fakeApi();
    const stop = startBot(db, { api: undefined, fetchImpl: vi.fn() as unknown as typeof fetch });
    stop();
    expect(api.getUpdates).not.toHaveBeenCalled();
  });

  it("erreur réseau puis 409 : la boucle continue (reprise 1 s, conflit 60 s) et traite les mises à jour", async () => {
    const db = freshDb();
    linkChat(db, String(CHAT));
    const { api, sent } = fakeApi();
    const handled = Promise.withResolvers<void>();
    let call = 0;
    api.getUpdates = vi.fn(async (offset: number, _t: number, signal?: AbortSignal) => {
      call++;
      if (call === 1) throw new TelegramError("Telegram getUpdates : fetch failed", undefined);
      if (call === 2) throw new TelegramError("Telegram getUpdates : Conflict", 409);
      if (call === 3) return [{ update_id: 50, message: { message_id: 1, chat: { id: CHAT, type: "private" }, text: "/aide" } }];
      expect(offset).toBe(51);
      handled.resolve();
      return new Promise<TelegramUpdate[]>((_, reject) =>
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))),
      );
    });
    const delays: number[] = [];
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const stop = startBot(db, { token: TOKEN, api, sleep: async (ms) => void delays.push(ms) });
    await handled.promise;
    stop();
    expect(delays).toEqual([1000, 60_000]);
    expect(sent[0].text).toContain("/bilan");
    for (const [msg] of errors.mock.calls) expect(String(msg)).not.toContain("SECRET");
  });

  it("canal telegram : alertes envoyées au chat relié avec préfixe ; non relié → rien", async () => {
    const db = freshDb();
    const { api, sent } = fakeApi();
    api.getUpdates = vi.fn((_o: number, _t: number, signal?: AbortSignal) =>
      new Promise<TelegramUpdate[]>((_, reject) =>
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))),
      ),
    );
    const stop = startBot(db, { token: TOKEN, api, sleep: async () => {} });
    try {
      const alert: Message = addMessage(db, { role: "assistant", kind: "alert", content: "Budget **dépassé**", source: "system" });
      await dispatch(alert);
      expect(sent).toHaveLength(0);
      linkChat(db, String(CHAT));
      await dispatch(alert);
      const digest = addMessage(db, { role: "assistant", kind: "monthly", content: "Bilan", source: "system" });
      await dispatch(digest);
      expect(sent.map((s) => s.text)).toEqual(["🔔 Budget <b>dépassé</b>", "📊 Bilan"]);
      // Une seconde instance n'est pas démarrée (garde globalThis).
      const again = startBot(db, { token: TOKEN, api, sleep: async () => {} });
      again();
    } finally {
      stop();
    }
  });
});

describe("routes Telegram", () => {
  let ready = false;
  const saved = process.env.TELEGRAM_BOT_TOKEN;
  beforeEach(() => {
    const db = getDb();
    if (!ready) {
      runMigrations(db);
      seedDefaults(db);
      ready = true;
    }
    db.delete(messagesTable).run();
    unlinkTelegram(db);
    resetBotUsernameCache();
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = saved;
  });

  it("sans token : link → 409, status non configuré", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const res = await linkPOST();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Telegram n'est pas configuré");
    expect(await (await statusGET()).json()).toEqual({ configured: false, linked: false, botUsername: null });
  });

  it("avec token : code, statut (getMe en cache), déliaison", async () => {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    const fetchMock = vi.fn(async () => Response.json({ ok: true, result: { id: 1, username: "finance_bot" } }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await linkPOST();
    const body = await res.json();
    expect(body.code).toMatch(/^\d{6}$/);
    expect(body.botUsername).toBe("finance_bot");
    expect(body.expiresAt).toBeGreaterThan(Date.now());

    linkChat(getDb(), String(CHAT));
    expect(await (await statusGET()).json()).toEqual({ configured: true, linked: true, botUsername: "finance_bot" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(await (await linkDELETE()).json()).toEqual({ ok: true });
    expect(linkedChatId(getDb())).toBeNull();
    expect(getSetting(getDb(), CHAT_ID_KEY, (await import("zod")).z.unknown(), null)).toBeNull();
  });

  it("getMe en erreur → botUsername null", async () => {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await (await statusGET()).json()).toMatchObject({ configured: true, botUsername: null });
  });
});
