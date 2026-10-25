import { BadRequestError } from "@/lib/api";
import { aiErrorInfo, effectiveModel, getAi, type Ai } from "@/lib/ai/client";
import { listModels } from "@/lib/ai/models";
import { ModelUnavailableError, respond } from "@/lib/assistant/conversation";
import { registerChannel } from "@/lib/assistant/dispatch";
import type { Db } from "@/lib/db";
import { addMessage, type Message } from "@/lib/queries/messages";
import { setModelSetting } from "@/lib/settings";
import { isParseEntitiesError, telegramApi, TelegramError, type TelegramApi, type TelegramUpdate } from "./api";
import { splitMessage, toTelegramHtml } from "./format";
import { consumeLinkCode, linkChat, linkedChatId, telegramToken } from "./link";

export { TELEGRAM_HINT } from "@/lib/ai/chat";

export const PRIVATE_MESSAGE = "Ce bot est privé.";
export const NON_TEXT_MESSAGE = "Je ne lis que le texte pour l'instant.";
export const TOO_LONG_MESSAGE = "Message trop long (8 000 caractères maximum).";
export const AI_DISABLED_TELEGRAM_MESSAGE =
  "L'assistant IA est désactivé : ajoutez ANTHROPIC_API_KEY sur le serveur.";
export const LINKED_MESSAGE = "Telegram est relié à Finance AI.";
export const BAD_CODE_MESSAGE = "Code invalide ou expiré : générez-en un nouveau dans Réglages.";
export const NEW_CONVERSATION_MESSAGE = "Nouvelle conversation.";
export const BILAN_PROMPT = "Fais-moi un bilan de mon mois en cours.";
export const GENERIC_ERROR_MESSAGE = "Une erreur est survenue. Réessayez.";

export const MAX_TEXT_LENGTH = 8000;
export const TYPING_INTERVAL_MS = 4000;
const PRIVATE_NOTICE_MS = 3600_000;
const START_WINDOW_MS = 10 * 60_000;
const START_MAX_FAILURES = 5;

const HELP = [
  "<b>Finance AI</b> : posez votre question, je réponds à partir de vos données.",
  "",
  "/bilan : bilan du mois en cours",
  "/nouveau : nouvelle conversation",
  "/modele : modèle Claude utilisé (/modele &lt;id&gt; pour le changer)",
  "/aide : cette aide",
].join("\n");

/** État en mémoire : anti force brute des codes et limitation de « Ce bot est privé. ». */
export type BotGuard = { failures: number[]; blockedUntil: number; privateNotified: Map<string, number> };

export type BotContext = {
  db: Db;
  api: TelegramApi;
  getAi: () => Ai | null;
  respond: typeof respond;
  listModels: typeof listModels;
  now: () => number;
  typingIntervalMs: number;
  guard: BotGuard;
};

export function createBotContext(
  db: Db,
  api: TelegramApi,
  overrides: Partial<Omit<BotContext, "db" | "api">> = {},
): BotContext {
  return {
    db,
    api,
    getAi: () => getAi(db),
    respond,
    listModels,
    now: Date.now,
    typingIntervalMs: TYPING_INTERVAL_MS,
    guard: { failures: [], blockedUntil: 0, privateNotified: new Map() },
    ...overrides,
  };
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Envoie du markdown de l'assistant : découpé, converti en HTML, repli en texte brut si refusé. */
export async function sendMarkdown(api: TelegramApi, chatId: string, markdown: string): Promise<void> {
  for (const chunk of splitMessage(markdown)) {
    try {
      await api.sendMessage(chatId, toTelegramHtml(chunk));
    } catch (err) {
      if (!isParseEntitiesError(err)) throw err;
      await api.sendMessage(chatId, chunk, { plain: true });
    }
  }
}

/** Texte d'erreur sûr pour les journaux (le token est déjà expurgé des `TelegramError`). */
function describe(err: unknown): string {
  if (err instanceof TelegramError) return err.message;
  if (err instanceof Error) {
    const token = telegramToken();
    const text = `${err.name}: ${err.message}`;
    return token ? text.split(token).join("***") : text;
  }
  return "erreur inconnue";
}

function parseCommand(text: string): { name: string; args: string } | null {
  const m = /^\/([a-zA-Z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(text);
  return m ? { name: m[1].toLowerCase(), args: (m[2] ?? "").trim() } : null;
}

/** Message d'un chat non relié : seul `/start <code>` est examiné ; aucune donnée lue ni écrite. */
async function handleStranger(ctx: BotContext, chatId: string, text: string | null): Promise<void> {
  const now = ctx.now();
  const command = text === null ? null : parseCommand(text.trim());
  if (command?.name === "start" && command.args) {
    const { guard } = ctx;
    if (now < guard.blockedUntil) return;
    if (consumeLinkCode(ctx.db, command.args, now)) {
      linkChat(ctx.db, chatId);
      guard.failures = [];
      guard.privateNotified.delete(chatId);
      await ctx.api.sendMessage(chatId, `${LINKED_MESSAGE}\n\n${HELP}`);
      return;
    }
    guard.failures = guard.failures.filter((t) => now - t < START_WINDOW_MS);
    guard.failures.push(now);
    if (guard.failures.length >= START_MAX_FAILURES) {
      guard.blockedUntil = now + START_WINDOW_MS;
      guard.failures = [];
      console.error("[telegram] trop de codes de liaison invalides : /start ignoré pendant 10 minutes");
    }
    await ctx.api.sendMessage(chatId, escapeHtml(BAD_CODE_MESSAGE));
    return;
  }

  const notified = ctx.guard.privateNotified;
  const last = notified.get(chatId);
  if (last !== undefined && now - last < PRIVATE_NOTICE_MS) return;
  if (notified.size > 1000) {
    for (const [id, at] of notified) if (now - at >= PRIVATE_NOTICE_MS) notified.delete(id);
  }
  notified.set(chatId, now);
  await ctx.api.sendMessage(chatId, escapeHtml(PRIVATE_MESSAGE));
}

async function handleModel(ctx: BotContext, chatId: string, arg: string): Promise<void> {
  const models = await ctx.listModels(ctx.getAi());
  if (arg) {
    const model = models.find((m) => m.id === arg);
    if (!model) {
      await ctx.api.sendMessage(chatId, "Modèle inconnu. Envoyez /modele pour voir la liste.");
      return;
    }
    setModelSetting(ctx.db, model.id);
    await ctx.api.sendMessage(chatId, `Modèle choisi : <b>${escapeHtml(model.name)}</b> (<code>${escapeHtml(model.id)}</code>).`);
    return;
  }
  const current = effectiveModel(ctx.db);
  const list = models.map((m) => `• <code>${escapeHtml(m.id)}</code> : ${escapeHtml(m.name)}`).join("\n");
  await ctx.api.sendMessage(
    chatId,
    `Modèle actuel : <code>${escapeHtml(current)}</code>\n\nModèles disponibles :\n${list}\n\nPour changer : /modele &lt;id&gt;`,
  );
}

/** Ajoute le message au fil, fait répondre Claude (« typing » toutes les 4 s) et envoie la réponse. */
async function converse(ctx: BotContext, chatId: string, content: string): Promise<void> {
  const ai = ctx.getAi();
  if (!ai) {
    await ctx.api.sendMessage(chatId, escapeHtml(AI_DISABLED_TELEGRAM_MESSAGE));
    return;
  }
  addMessage(ctx.db, { role: "user", kind: "chat", content, source: "telegram" });

  const typing = () => void ctx.api.sendChatAction(chatId, "typing").catch(() => {});
  typing();
  const timer = setInterval(typing, ctx.typingIntervalMs);
  let reply: Message | null;
  try {
    reply = await ctx.respond(ctx.db, { ai, source: "telegram", channel: "telegram" });
  } catch (err) {
    let text: string;
    if (err instanceof ModelUnavailableError || err instanceof BadRequestError) text = err.message;
    else {
      const info = aiErrorInfo(err);
      if (!info) console.error(`[telegram] erreur pendant la conversation : ${describe(err)}`);
      text = info?.message ?? GENERIC_ERROR_MESSAGE;
    }
    await ctx.api.sendMessage(chatId, escapeHtml(text));
    return;
  } finally {
    clearInterval(timer);
  }
  // La réponse n'est pas diffusée vers le canal d'origine : on l'envoie ici.
  if (reply) await sendMarkdown(ctx.api, chatId, reply.content);
}

/**
 * Traite une mise à jour Telegram. Seuls les messages de chats privés sont examinés ; un chat
 * autre que le chat relié ne reçoit que « Ce bot est privé. » (ou la réponse à `/start <code>`).
 */
export async function handleUpdate(ctx: BotContext, update: TelegramUpdate): Promise<void> {
  const message = update.message;
  if (!message || message.chat?.type !== "private") return;
  const chatId = String(message.chat.id);
  const text = typeof message.text === "string" ? message.text : null;

  if (linkedChatId(ctx.db) !== chatId) {
    await handleStranger(ctx, chatId, text);
    return;
  }
  if (text === null) {
    await ctx.api.sendMessage(chatId, escapeHtml(NON_TEXT_MESSAGE));
    return;
  }
  const content = text.trim();
  if (!content) return;
  if (content.length > MAX_TEXT_LENGTH) {
    await ctx.api.sendMessage(chatId, escapeHtml(TOO_LONG_MESSAGE));
    return;
  }

  const command = parseCommand(content);
  if (!command) {
    await converse(ctx, chatId, content);
    return;
  }
  switch (command.name) {
    case "nouveau":
      addMessage(ctx.db, { role: "divider", kind: "divider", content: "", source: "telegram" });
      await ctx.api.sendMessage(chatId, NEW_CONVERSATION_MESSAGE);
      return;
    case "bilan":
      await converse(ctx, chatId, BILAN_PROMPT);
      return;
    case "modele":
      await handleModel(ctx, chatId, command.args);
      return;
    default:
      // /aide, /start (déjà relié), commande inconnue.
      await ctx.api.sendMessage(chatId, HELP);
  }
}

/** Envoie un message assistant (alerte, bilan, réponse venue de l'app) au chat relié, s'il existe. */
export async function sendToLinkedChat(ctx: BotContext, m: Message): Promise<void> {
  if (m.role !== "assistant" || !m.content.trim()) return;
  const chatId = linkedChatId(ctx.db);
  if (!chatId) return;
  const prefix = m.kind === "alert" ? "🔔 " : m.kind === "weekly" || m.kind === "monthly" ? "📊 " : "";
  await sendMarkdown(ctx.api, chatId, prefix + m.content);
}

export const POLL_TIMEOUT_SEC = 30;
export const BACKOFF_MIN_MS = 1000;
export const BACKOFF_MAX_MS = 60_000;

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

export type StartBotOptions = {
  /** Token ; défaut `TELEGRAM_BOT_TOKEN`. */
  token?: string | null;
  /** API simulée (tests) ; défaut `telegramApi(token, fetchImpl)`. */
  api?: TelegramApi;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  context?: Partial<Omit<BotContext, "db" | "api">>;
};

/**
 * Démarre le bot si un token est configuré : canal de diffusion `telegram` et boucle de long
 * polling (mises à jour traitées une à une, dans l'ordre ; reprise exponentielle 1 → 60 s ;
 * conflit 409 → 60 s). Une seule instance par processus. Renvoie la fonction d'arrêt.
 */
export function startBot(db: Db, opts: StartBotOptions = {}): () => void {
  const token = opts.token === undefined ? telegramToken() : opts.token;
  if (!token) return () => {};
  const g = globalThis as typeof globalThis & { __financeAiTelegramBot?: object };
  if (g.__financeAiTelegramBot) return () => {};
  const instance = {};
  g.__financeAiTelegramBot = instance;

  const api = opts.api ?? telegramApi(token, opts.fetchImpl);
  const ctx = createBotContext(db, api, opts.context);
  const sleep = opts.sleep ?? abortableSleep;
  const controller = new AbortController();
  const { signal } = controller;
  const unregister = registerChannel("telegram", (m) => sendToLinkedChat(ctx, m));

  void (async () => {
    let offset = 0;
    let delay = BACKOFF_MIN_MS;
    let conflictLogged = false;
    while (!signal.aborted) {
      let updates: TelegramUpdate[];
      try {
        updates = await api.getUpdates(offset, POLL_TIMEOUT_SEC, signal);
      } catch (err) {
        if (signal.aborted) break;
        if (err instanceof TelegramError && err.status === 409) {
          if (!conflictLogged) {
            console.error(
              "[telegram] conflit 409 : un webhook ou une autre instance lit déjà les messages de ce bot ; nouvel essai dans 60 s.",
            );
            conflictLogged = true;
          }
          await sleep(BACKOFF_MAX_MS, signal);
          continue;
        }
        console.error(`[telegram] ${describe(err)} ; nouvel essai dans ${Math.round(delay / 1000)} s.`);
        const wait = err instanceof TelegramError && err.retryAfter ? Math.min(err.retryAfter * 1000, BACKOFF_MAX_MS) : delay;
        await sleep(wait, signal);
        delay = Math.min(delay * 2, BACKOFF_MAX_MS);
        continue;
      }
      delay = BACKOFF_MIN_MS;
      conflictLogged = false;
      for (const update of updates) {
        if (signal.aborted) break;
        offset = Math.max(offset, update.update_id + 1);
        try {
          await handleUpdate(ctx, update);
        } catch (err) {
          console.error(`[telegram] échec du traitement d'un message : ${describe(err)}`);
        }
      }
    }
  })();

  return () => {
    controller.abort();
    unregister();
    if (g.__financeAiTelegramBot === instance) g.__financeAiTelegramBot = undefined;
  };
}
