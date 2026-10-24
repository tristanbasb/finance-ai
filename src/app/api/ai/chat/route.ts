import { readJson } from "@/lib/api";
import { getDb } from "@/lib/db";
import { aiErrorInfo, isAbortError, requireAi } from "@/lib/ai/client";
import { chatRequest, encodeSse, runChat } from "@/lib/ai/chat";
import { withAiErrors } from "@/lib/ai/route";

export const dynamic = "force-dynamic";

/**
 * Conversation avec l'assistant, en flux SSE : `data: {"type":"text"|"tool"|"done"|"error",…}`.
 * Les erreurs de validation ou l'IA désactivée renvoient une réponse JSON avant le flux ;
 * une erreur pendant le flux devient un événement `error`. Le flux amont est interrompu
 * dès que le client se déconnecte.
 */
export const POST = withAiErrors(async (req: Request) => {
  const ai = requireAi();
  const { messages } = chatRequest.parse(await readJson(req));
  const db = getDb();

  const upstream = new AbortController();
  const abort = () => upstream.abort();
  if (req.signal.aborted) abort();
  else req.signal.addEventListener("abort", abort, { once: true });

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        if (!upstream.signal.aborted) controller.enqueue(encoder.encode(chunk));
      };
      try {
        for await (const event of runChat({ ai, db, messages, signal: upstream.signal })) {
          if (upstream.signal.aborted) break;
          send(encodeSse(event));
        }
      } catch (err) {
        if (!isAbortError(err) && !upstream.signal.aborted) {
          const info = aiErrorInfo(err);
          if (!info) console.error("[ai] erreur pendant la conversation :", err);
          send(encodeSse({ type: "error", error: info?.message ?? "Une erreur est survenue. Réessayez." }));
        }
      } finally {
        req.signal.removeEventListener("abort", abort);
        try {
          controller.close();
        } catch {
          /* flux déjà annulé par le client */
        }
      }
    },
    cancel() {
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
