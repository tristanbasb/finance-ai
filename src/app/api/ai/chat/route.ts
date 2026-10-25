import { readJson } from "@/lib/api";
import { getDb } from "@/lib/db";
import { aiErrorInfo, isAbortError, requireAi } from "@/lib/ai/client";
import { chatRequest, encodeSse } from "@/lib/ai/chat";
import { withAiErrors } from "@/lib/ai/route";
import { ModelUnavailableError, respond } from "@/lib/assistant/conversation";
import { addMessage } from "@/lib/queries/messages";

export const dynamic = "force-dynamic";

/** Intervalle du commentaire SSE `: ping` qui garde la connexion ouverte (proxys, longues réflexions). */
export const HEARTBEAT_MS = 15_000;

/**
 * Nouveau message de l'utilisateur `{ content }` : enregistré dans le fil (source `app`), puis
 * réponse de l'assistant en flux SSE : `data: {"type":"text"|"tool"|"saved"|"done"|"error",…}`
 * (`saved` porte l'id du message assistant enregistré, juste avant `done`).
 * Les erreurs de validation ou l'IA désactivée renvoient une réponse JSON avant le flux (rien
 * n'est alors enregistré) ;
 * une erreur pendant le flux devient un événement `error`. Un commentaire `: ping` est envoyé
 * toutes les 15 s tant que le flux est ouvert. Le flux amont est interrompu dès que le client
 * se déconnecte.
 */
export const POST = withAiErrors(async (req: Request) => {
  const db = getDb();
  const ai = requireAi(db);
  const { content } = chatRequest.parse(await readJson(req));
  addMessage(db, { role: "user", kind: "chat", content, source: "app" });

  const upstream = new AbortController();
  const abort = () => upstream.abort();
  if (req.signal.aborted) abort();
  else req.signal.addEventListener("abort", abort, { once: true });

  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stopHeartbeat = () => {
    if (heartbeat !== undefined) clearInterval(heartbeat);
    heartbeat = undefined;
  };
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        if (upstream.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          /* flux fermé côté client */
        }
      };
      heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);
      try {
        const saved = await respond(db, {
          ai,
          source: "app",
          signal: upstream.signal,
          onEvent: (event) => send(encodeSse(event)),
        });
        // Rien à enregistrer (message déjà répondu par une génération précédente) : fin du flux.
        if (!saved) send(encodeSse({ type: "done" }));
      } catch (err) {
        if (err instanceof ModelUnavailableError) {
          send(encodeSse({ type: "error", error: err.message }));
        } else if (!isAbortError(err) && !upstream.signal.aborted) {
          const info = aiErrorInfo(err);
          if (!info) console.error("[ai] erreur pendant la conversation :", err);
          send(encodeSse({ type: "error", error: info?.message ?? "Une erreur est survenue. Réessayez." }));
        }
      } finally {
        stopHeartbeat();
        req.signal.removeEventListener("abort", abort);
        try {
          controller.close();
        } catch {
          /* flux déjà annulé par le client */
        }
      }
    },
    cancel() {
      stopHeartbeat();
      abort();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
});
