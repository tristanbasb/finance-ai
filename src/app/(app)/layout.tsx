import { AssistantProvider } from "@/components/assistant/assistant-provider";
import { QuickAddProvider } from "@/components/quick-add/quick-add-provider";
import { AppShell } from "@/components/shell/app-shell";
import { Toaster } from "@/components/ui/toast";
import { getAi } from "@/lib/ai/client";

// Données et snapshots toujours frais ; le build ne touche jamais la base.
export const dynamic = "force-dynamic";

export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // Seule la présence de la clé API est transmise au client, jamais sa valeur.
    <AssistantProvider aiEnabled={getAi() !== null}>
      <QuickAddProvider>
        <AppShell>{children}</AppShell>
        <Toaster />
      </QuickAddProvider>
    </AssistantProvider>
  );
}
