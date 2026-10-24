// Conversation de l'assistant conservée dans le navigateur (localStorage).

/** Clé localStorage de la conversation de l'assistant. */
export const ASSISTANT_STORAGE_KEY = "finance-ai.assistant.conversation.v1";

/** Efface la conversation enregistrée (à la déconnexion) ; sans effet si le stockage est indisponible. */
export function clearAssistantConversation(): void {
  try {
    window.localStorage.removeItem(ASSISTANT_STORAGE_KEY);
  } catch {
    /* stockage indisponible (navigation privée, cookies bloqués) : rien à effacer */
  }
}
