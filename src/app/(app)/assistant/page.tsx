import type { Metadata } from "next";
import { AssistantConversation } from "@/components/assistant/chat";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Assistant" };

export default function AssistantPage() {
  return <AssistantConversation variant="page" />;
}
