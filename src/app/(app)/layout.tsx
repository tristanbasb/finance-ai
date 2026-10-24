import { MobileHeader, MobileTabBar } from "@/components/mobile-nav";
import { Sidebar } from "@/components/sidebar";
import { Toaster } from "@/components/ui/toast";

// Données et snapshots toujours frais ; le build ne touche jamais la base.
export const dynamic = "force-dynamic";

export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-dvh md:pl-60">
      <Sidebar />
      <MobileHeader />
      <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 sm:px-6 md:px-10 md:pb-16 md:pt-10">
        {children}
      </main>
      <MobileTabBar />
      <Toaster />
    </div>
  );
}
