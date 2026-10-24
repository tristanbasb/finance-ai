import Anthropic from "@anthropic-ai/sdk";

export const DEFAULT_MODEL = "claude-opus-5-5";

export const AI_DISABLED_MESSAGE = "Assistant IA désactivé : ajoutez ANTHROPIC_API_KEY dans .env";

export type Ai = { client: Anthropic; model: string };

/** Levée quand aucune clé n'est configurée (HTTP 503). */
export class AiDisabledError extends Error {
  constructor() {
    super(AI_DISABLED_MESSAGE);
    this.name = "AiDisabledError";
  }
}

/** Réponse du modèle inexploitable (sortie vide ou hors schéma) : traitée comme une indisponibilité. */
export class AiOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiOutputError";
  }
}

let cached: { key: string; client: Anthropic } | undefined;

/** Modèle configuré (`CLAUDE_MODEL`, sinon le modèle par défaut), lu à chaque appel. */
export function aiModel(): string {
  return process.env.CLAUDE_MODEL?.trim() || DEFAULT_MODEL;
}

/**
 * Client Claude, ou null sans `ANTHROPIC_API_KEY` (rognée, non vide). Lu à l'appel (jamais à
 * l'import ni au build) ; le client est réutilisé tant que la clé ne change pas.
 * `ANTHROPIC_BASE_URL` est pris en compte par le SDK.
 */
export function getAi(): Ai | null {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  if (!cached || cached.key !== key) cached = { key, client: new Anthropic({ apiKey: key }) };
  return { client: cached.client, model: aiModel() };
}

/** Comme `getAi`, mais lève `AiDisabledError` sans clé. */
export function requireAi(): Ai {
  const ai = getAi();
  if (!ai) throw new AiDisabledError();
  return ai;
}

/** Vrai si l'erreur vient d'une annulation (client parti, bouton « Arrêter »). */
export function isAbortError(err: unknown): boolean {
  return err instanceof Anthropic.APIUserAbortError || (err instanceof Error && err.name === "AbortError");
}

/**
 * Traduit une erreur de l'API Claude, du SDK (sortie illisible) ou d'indisponibilité IA en statut
 * HTTP + message français. Renvoie null pour une annulation ou toute autre erreur. Journalise côté serveur sans la clé ni les en-têtes.
 */
export function aiErrorInfo(err: unknown): { status: number; message: string } | null {
  if (err instanceof AiDisabledError) return { status: 503, message: AI_DISABLED_MESSAGE };
  if (err instanceof AiOutputError) {
    console.error("[ai] réponse inexploitable :", err.message);
    return { status: 502, message: "Le service Claude est indisponible." };
  }
  if (!(err instanceof Anthropic.AnthropicError) || isAbortError(err)) return null;
  if (!(err instanceof Anthropic.APIError)) {
    // Erreur du SDK hors HTTP : sortie structurée illisible (coupée par max_tokens, refus…).
    console.error(`[ai] réponse Claude inexploitable : ${err.message}`);
    return { status: 502, message: "Le service Claude est indisponible." };
  }
  console.error(
    `[ai] erreur API Claude : type=${err.type ?? "-"} status=${err.status ?? "-"} request_id=${err.requestID ?? "-"} — ${err.message}`,
  );
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return { status: 502, message: "Clé API Claude invalide" };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { status: 429, message: "Limite de l'API Claude atteinte, réessayez plus tard." };
  }
  return { status: 502, message: "Le service Claude est indisponible." };
}
