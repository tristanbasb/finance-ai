import type { Metadata } from "next";
import { getAi } from "@/lib/ai/client";
import { AssistantChat } from "@/components/assistant/chat";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Assistant" };

export default function AssistantPage() {
  // Seule la présence de la clé est transmise au client, jamais sa valeur.
  return <AssistantChat enabled={getAi() !== null} />;
}
