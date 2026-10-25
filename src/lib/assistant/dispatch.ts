import type { Message } from "@/lib/queries/messages";

export type ChannelSend = (m: Message) => Promise<void>;

// Registre porté par `globalThis` : partagé entre les exemplaires du module que Next.js peut
// charger séparément (instrumentation, où démarre le bot, et routes).
const g = globalThis as typeof globalThis & { __financeAiChannels?: Map<string, ChannelSend> };
const channels: Map<string, ChannelSend> = (g.__financeAiChannels ??= new Map());

/**
 * Inscrit un canal de diffusion (ex. `telegram`). Un même nom remplace l'inscription précédente.
 * Renvoie la fonction de désinscription (sans effet si le canal a été remplacé entre-temps).
 */
export function registerChannel(name: string, send: ChannelSend): () => void {
  channels.set(name, send);
  return () => {
    if (channels.get(name) === send) channels.delete(name);
  };
}

/**
 * Diffuse un message à tous les canaux inscrits, sauf `except` (le canal d'origine). Les erreurs
 * de canal sont journalisées (sans le contenu du message) et jamais propagées.
 */
export async function dispatch(m: Message, opts: { except?: string } = {}): Promise<void> {
  const targets = [...channels].filter(([name]) => name !== opts.except);
  const results = await Promise.allSettled(targets.map(([, send]) => Promise.resolve().then(() => send(m))));
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      const reason = r.reason instanceof Error ? `${r.reason.name}: ${r.reason.message}` : String(r.reason);
      console.error(`[assistant] échec de diffusion vers « ${targets[i][0]} » (message ${m.id}, ${m.kind}) : ${reason}`);
    }
  });
}
