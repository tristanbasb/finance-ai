import { BadRequestError, ConflictError } from "@/lib/api";
import type { Db } from "@/lib/db";
import { isAbortError, isModelNotFound, type Ai } from "@/lib/ai/client";
import { attachActionsToMessage } from "@/lib/ai/actions";
import { runChat, type ChatChannel, type WriteSession } from "@/lib/ai/chat";
import {
  addMessage,
  contextMessages,
  pendingUserMessages,
  type Message,
  type MessageKind,
} from "@/lib/queries/messages";
import { aiCanWrite, setModelSetting } from "@/lib/settings";
import type { ChatEvent } from "@/lib/sse";
import { dispatch } from "./dispatch";
import { withGenerationLock } from "./lock";

export const MODEL_UNAVAILABLE_MESSAGE = "Le modèle choisi n'est plus disponible ; modèle par défaut rétabli.";
export const NO_ANSWER_MESSAGE = "Je n'ai pas pu répondre.";
export const INTERRUPTED_SUFFIX = "\n\n_(interrompu)_";
/** Fin d'une réponse coupée par une erreur alors que des modifications ont déjà été faites. */
export const ACTIONS_INTERRUPTED_NOTE =
  "_(Réponse interrompue par une erreur. Les modifications ci-dessous ont bien été faites ; vous pouvez les annuler.)_";
/** Réponse annulée sans texte alors que des modifications ont déjà été faites. */
export const ACTIONS_ONLY_MESSAGE = "Modifications effectuées avant l'interruption.";

/** Le modèle réglé n'existe plus : le réglage a été effacé (HTTP 409). */
export class ModelUnavailableError extends ConflictError {
  constructor() {
    super(MODEL_UNAVAILABLE_MESSAGE);
    this.name = "ModelUnavailableError";
  }
}

/**
 * Ajoute un message proactif ou système (alerte, bilan, « Action annulée ») au fil, puis le
 * diffuse à tous les canaux sauf `except`. `read` : enregistré comme déjà lu (pas de badge).
 */
export async function postAssistantMessage(
  db: Db,
  m: { kind: MessageKind; content: string; meta?: Record<string, unknown> | null; read?: boolean },
  opts: { except?: string } = {},
): Promise<Message> {
  const message = addMessage(db, {
    role: "assistant",
    kind: m.kind,
    content: m.content,
    source: "system",
    meta: m.meta,
    readAt: m.read ? Date.now() : null,
  });
  await dispatch(message, opts);
  return message;
}

/**
 * Génère la réponse de Claude au fil (le message utilisateur doit déjà être enregistré), sous
 * verrou : lecture du contexte, génération, enregistrement puis diffusion aux autres canaux.
 * Les événements `text`/`tool` sont relayés à `onEvent`, suivis de `saved` puis `done`.
 * Le message enregistré porte `meta.replyTo` (id du dernier message utilisateur traité).
 * Renvoie null si rien n'a été enregistré (annulation sans texte, aucun message en attente).
 *
 * Écriture : toujours un tour déclenché par l'utilisateur (app, Telegram, relance `{ retry }`
 * de l'app) ; les outils d'écriture sont donc fournis si le réglage `ai_can_write` est vrai,
 * sauf `allowWrite: false` (invite fixe comme `/bilan` sur Telegram).
 * Les actions journalisées sont listées dans `meta.actions` (si non vide) et rattachées au
 * message. Si des modifications ont eu lieu, un message est TOUJOURS enregistré, même en cas
 * d'erreur (texte partiel + `ACTIONS_INTERRUPTED_NOTE`, sans lever) ou d'annulation : les cartes
 * « Fait » restent visibles et la question est marquée traitée, si bien qu'une relance ne
 * rejoue jamais des écritures déjà faites.
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
    allowWrite = true,
  }: {
    ai: Ai;
    source: "app" | "telegram";
    signal?: AbortSignal;
    onEvent?: (e: ChatEvent) => void;
    today?: string;
    /** Canal de lecture (consigne de format dans le prompt) ; défaut : application. */
    channel?: ChatChannel;
    /** Faux : aucun outil d'écriture pour ce tour, quel que soit le réglage. */
    allowWrite?: boolean;
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

    const write: WriteSession | undefined = allowWrite && aiCanWrite(db) ? { actionIds: [] } : undefined;
    const hasActions = () => (write?.actionIds.length ?? 0) > 0;
    let text = "";
    let aborted = false;
    let failed = false;
    try {
      for await (const event of runChat({ ai, db, messages: context, signal, today, channel, write })) {
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
      else if (hasActions()) {
        // Des modifications sont faites : la réponse est enregistrée malgré l'erreur.
        console.error("[ai] erreur après des modifications :", err);
        failed = true;
      } else if (isModelNotFound(err)) {
        setModelSetting(db, null);
        throw new ModelUnavailableError();
      } else throw err;
    }

    let content: string;
    if (failed) {
      content = text.trim() ? `${text}\n\n${ACTIONS_INTERRUPTED_NOTE}` : ACTIONS_INTERRUPTED_NOTE;
    } else if (aborted) {
      if (!text.trim() && !hasActions()) return null;
      content = (text.trim() ? text : ACTIONS_ONLY_MESSAGE) + INTERRUPTED_SUFFIX;
    } else {
      content = text.trim() ? text : NO_ANSWER_MESSAGE;
    }

    const actions = write?.actionIds ?? [];
    const message = addMessage(db, {
      role: "assistant",
      kind: "chat",
      source,
      content,
      meta: actions.length ? { replyTo, actions: [...actions] } : { replyTo },
    });
    attachActionsToMessage(db, actions, message.id);
    onEvent?.({ type: "saved", id: message.id });
    onEvent?.({ type: "done" });
    await dispatch(message, { except: source });
    return message;
  });
}
