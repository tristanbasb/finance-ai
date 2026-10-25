// Ancienne conversation de l'assistant conservée dans le navigateur (localStorage), remplacée
// par le fil enregistré sur le serveur. La clé est supprimée au chargement de l'application
// (AssistantProvider) et à la déconnexion, pour ne laisser aucune donnée financière en local.

/** Clé localStorage de l'ancienne conversation de l'assistant (plus écrite). */
export const ASSISTANT_STORAGE_KEY = "finance-ai.assistant.conversation.v1";

/** Efface l'ancienne conversation locale ; sans effet si le stockage est indisponible. */
export function clearAssistantConversation(): void {
  try {
    window.localStorage.removeItem(ASSISTANT_STORAGE_KEY);
  } catch {
    /* stockage indisponible (navigation privée, cookies bloqués) : rien à effacer */
  }
}
