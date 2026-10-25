import { AssistantProvider } from "@/components/assistant/assistant-provider";
import { ChatBubble } from "@/components/assistant/chat-bubble";
import { ChatPanel } from "@/components/assistant/chat-panel";
import { QuickAddProvider } from "@/components/quick-add/quick-add-provider";
import { MobileHeader, MobileTabBar } from "@/components/mobile-nav";
import { Sidebar } from "@/components/sidebar";
import { Toaster } from "@/components/ui/toast";
import { getAi } from "@/lib/ai/client";

// Données et snapshots toujours frais ; le build ne touche jamais la base.
export const dynamic = "force-dynamic";

export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // Seule la présence de la clé API est transmise au client, jamais sa valeur.
    <AssistantProvider aiEnabled={getAi() !== null}>
      <QuickAddProvider>
        <div className="min-h-dvh md:pl-60">
          <Sidebar />
          <MobileHeader />
          <main className="mx-auto w-full max-w-6xl px-4 pb-44 pt-6 sm:px-6 md:px-10 md:pb-28 md:pt-10">
            {children}
          </main>
          <MobileTabBar />
          <ChatBubble />
          <ChatPanel />
          <Toaster />
        </div>
      </QuickAddProvider>
    </AssistantProvider>
  );
}
