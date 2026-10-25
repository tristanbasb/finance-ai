import { BadRequestError, ConflictError } from "@/lib/api";
import type { Db } from "@/lib/db";
import { isAbortError, isModelNotFound, type Ai } from "@/lib/ai/client";
import { runChat, type ChatChannel } from "@/lib/ai/chat";
import {
  addMessage,
  contextMessages,
  pendingUserMessages,
  type Message,
  type MessageKind,
} from "@/lib/queries/messages";
import { setModelSetting } from "@/lib/settings";
import type { ChatEvent } from "@/lib/sse";
import { dispatch } from "./dispatch";
import { withGenerationLock } from "./lock";

export const MODEL_UNAVAILABLE_MESSAGE = "Le modèle choisi n'est plus disponible ; modèle par défaut rétabli.";
export const NO_ANSWER_MESSAGE = "Je n'ai pas pu répondre.";
export const INTERRUPTED_SUFFIX = "\n\n_(interrompu)_";

/** Le modèle réglé n'existe plus : le réglage a été effacé (HTTP 409). */
export class ModelUnavailableError extends ConflictError {
  constructor() {
    super(MODEL_UNAVAILABLE_MESSAGE);
    this.name = "ModelUnavailableError";
  }
}

/** Ajoute un message proactif (alerte, bilan) au fil, puis le diffuse à tous les canaux. */
export async function postAssistantMessage(
  db: Db,
  m: { kind: MessageKind; content: string; meta?: Record<string, unknown> | null },
): Promise<Message> {
  const message = addMessage(db, { role: "assistant", kind: m.kind, content: m.content, source: "system", meta: m.meta });
  await dispatch(message);
  return message;
}

/**
 * Génère la réponse de Claude au fil (le message utilisateur doit déjà être enregistré), sous
 * verrou : lecture du contexte, génération, enregistrement puis diffusion aux autres canaux.
 * Les événements `text`/`tool` sont relayés à `onEvent`, suivis de `saved` puis `done`.
 * Le message enregistré porte `meta.replyTo` (id du dernier message utilisateur traité).
 * Renvoie null si rien n'a été enregistré (annulation sans texte, aucun message en attente).
 */
export function respond(
  db: Db,
  {
    ai,
    source,
    signal,
    onEvent,
    today,
    channel,
  }: {
    ai: Ai;
    source: "app" | "telegram";
    signal?: AbortSignal;
    onEvent?: (e: ChatEvent) => void;
    today?: string;
    /** Canal de lecture (consigne de format dans le prompt) ; défaut : application. */
    channel?: ChatChannel;
  },
): Promise<Message | null> {
  return withGenerationLock(async () => {
    if (signal?.aborted) return null;
    const pending = pendingUserMessages(db);
    // Un message reçu pendant la génération précédente est enregistré avant la réponse de
    // celle-ci (ou une alerte a suivi la question) : il est replacé en fin de contexte.
    const context = contextMessages(db, { deferIds: pending.map((m) => m.id) });
    if (!context.length) throw new BadRequestError("Aucun message à traiter");
    // Messages déjà traités par une génération précédente de la file.
    if (!pending.length || context[context.length - 1].role !== "user") return null;
    const replyTo = pending[pending.length - 1].id;

    let text = "";
    let aborted = false;
    try {
      for await (const event of runChat({ ai, db, messages: context, signal, today, channel })) {
        // `done` : génération terminée normalement, même si l'annulation arrive ensuite.
        if (event.type === "done") continue;
        if (signal?.aborted) {
          aborted = true;
          break;
        }
        if (event.type === "text") text += event.text;
        onEvent?.(event);
      }
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) aborted = true;
      else if (isModelNotFound(err)) {
        setModelSetting(db, null);
        throw new ModelUnavailableError();
      } else throw err;
    }

    let content: string;
    if (aborted) {
      if (!text.trim()) return null;
      content = text + INTERRUPTED_SUFFIX;
    } else {
      content = text.trim() ? text : NO_ANSWER_MESSAGE;
    }

    const message = addMessage(db, { role: "assistant", kind: "chat", source, content, meta: { replyTo } });
    onEvent?.({ type: "saved", id: message.id });
    onEvent?.({ type: "done" });
    await dispatch(message, { except: source });
    return message;
  });
}
