// Événements de la conversation avec l'assistant, transportés en Server-Sent Events.
// Module pur, partagé entre la route (encodage) et le navigateur (décodage).

export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string }
  | { type: "saved"; id: number }
  | { type: "done" }
  | { type: "error"; error: string };

/** Sérialise un événement au format SSE (`data: <json>` suivi d'une ligne vide). */
export function encodeSse(event: ChatEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function isChatEvent(value: unknown): value is ChatEvent {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  switch (v.type) {
    case "text":
      return typeof v.text === "string";
    case "tool":
      return typeof v.name === "string";
    case "saved":
      return typeof v.id === "number";
    case "error":
      return typeof v.error === "string";
    case "done":
      return true;
    default:
      return false;
  }
}

/**
 * Extrait les événements complets d'un tampon SSE ; `rest` est la fin incomplète à conserver
 * pour le prochain fragment. Les lignes autres que `data:` et le JSON invalide sont ignorés.
 */
export function decodeSse(buffer: string): { events: ChatEvent[]; rest: string } {
  const normalized = buffer.replace(/\r\n?/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: ChatEvent[] = [];
  for (const part of parts) {
    const data = part
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) continue;
    try {
      const parsed: unknown = JSON.parse(data);
      if (isChatEvent(parsed)) events.push(parsed);
    } catch {
      /* événement illisible ignoré */
    }
  }
  return { events, rest };
}
