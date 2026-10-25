// Client minimal de l'API Bot Telegram (`fetch`, sans dépendance). Chaque appel a un délai
// maximal ; les erreurs sont des `TelegramError` dont le message ne contient jamais le token.

export type TelegramChat = { id: number; type: string };

export type TelegramMessage = {
  message_id: number;
  chat: TelegramChat;
  text?: string;
  [key: string]: unknown;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  [key: string]: unknown;
};

export type TelegramUser = { id: number; username?: string };

export type TelegramApi = {
  getMe(): Promise<TelegramUser>;
  /** Long polling : attend jusqu'à `timeoutSec` secondes de nouveaux messages après `offset`. */
  getUpdates(offset: number, timeoutSec: number, signal?: AbortSignal): Promise<TelegramUpdate[]>;
  /** Envoie `text` en HTML Telegram (`plain` : texte brut, sans `parse_mode`). */
  sendMessage(chatId: string, text: string, opts?: { plain?: boolean }): Promise<void>;
  sendChatAction(chatId: string, action: "typing"): Promise<void>;
};

/** Délai des appels courts (envoi, action, getMe). */
export const CALL_TIMEOUT_MS = 10_000;
/** Marge ajoutée au délai du long polling. */
export const POLL_MARGIN_MS = 10_000;
/** Attente maximale acceptée sur un 429 de `sendMessage` avant l'unique nouvel essai. */
export const MAX_RETRY_AFTER_SEC = 10;

/** Erreur de l'API Telegram ou du réseau (`status` : code HTTP/Telegram, absent si réseau). */
export class TelegramError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "TelegramError";
  }
}

/** Vrai si Telegram a refusé le HTML (entités mal formées). */
export function isParseEntitiesError(err: unknown): boolean {
  return err instanceof TelegramError && err.status === 400 && /can't parse entities/i.test(err.message);
}

export function telegramApi(token: string, fetchImpl: typeof fetch = fetch): TelegramApi {
  const redact = (text: string) =>
    text.split(token).join("***").split(encodeURIComponent(token)).join("***");

  async function call<T>(method: string, params: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
    const timeout = AbortSignal.timeout(timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      const detail = timeout.aborted ? "délai dépassé" : err instanceof Error ? err.message : String(err);
      throw new TelegramError(redact(`Telegram ${method} : ${detail}`));
    }
    let body: { ok?: boolean; result?: T; error_code?: number; description?: string; parameters?: { retry_after?: number } };
    try {
      body = await res.json();
    } catch {
      throw new TelegramError(`Telegram ${method} : réponse HTTP ${res.status} illisible`, res.status);
    }
    if (!res.ok || !body.ok) {
      const status = body.error_code ?? res.status;
      throw new TelegramError(
        redact(`Telegram ${method} : ${body.description ?? `HTTP ${res.status}`}`),
        status,
        body.parameters?.retry_after,
      );
    }
    return body.result as T;
  }

  return {
    getMe: () => call<TelegramUser>("getMe", {}, CALL_TIMEOUT_MS),
    getUpdates: (offset, timeoutSec, signal) =>
      call<TelegramUpdate[]>(
        "getUpdates",
        { offset, timeout: timeoutSec, allowed_updates: ["message"] },
        timeoutSec * 1000 + POLL_MARGIN_MS,
        signal,
      ),
    sendMessage: async (chatId, text, opts) => {
      const send = () =>
        call(
          "sendMessage",
          {
            chat_id: chatId,
            text,
            ...(opts?.plain ? {} : { parse_mode: "HTML" }),
            link_preview_options: { is_disabled: true },
          },
          CALL_TIMEOUT_MS,
        );
      try {
        await send();
      } catch (err) {
        // 429 : une seule nouvelle tentative après l'attente demandée, si elle reste courte.
        const wait = err instanceof TelegramError && err.status === 429 ? err.retryAfter : undefined;
        if (wait === undefined || wait < 0 || wait > MAX_RETRY_AFTER_SEC) throw err;
        await new Promise((r) => setTimeout(r, wait * 1000));
        await send();
      }
    },
    sendChatAction: async (chatId, action) => {
      await call("sendChatAction", { chat_id: chatId, action }, CALL_TIMEOUT_MS);
    },
  };
}

export const BOT_USERNAME_TTL_MS = 3600_000;
let usernameCache: { token: string; at: number; username: string | null } | undefined;

/** Réinitialise le cache de `botUsername` (tests). */
export function resetBotUsernameCache(): void {
  usernameCache = undefined;
}

/** Nom du bot (`getMe`, mis en cache 1 h) ; null en cas d'erreur (non mise en cache). */
export async function botUsername(token: string, fetchImpl?: typeof fetch, now: number = Date.now()): Promise<string | null> {
  if (usernameCache && usernameCache.token === token && now - usernameCache.at < BOT_USERNAME_TTL_MS) {
    return usernameCache.username;
  }
  try {
    const me = await telegramApi(token, fetchImpl).getMe();
    const username = me.username ?? null;
    usernameCache = { token, at: now, username };
    return username;
  } catch (err) {
    console.error(`[telegram] ${err instanceof TelegramError ? err.message : "getMe : erreur inattendue"}`);
    return null;
  }
}
