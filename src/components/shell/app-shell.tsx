"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { PanelRightOpen } from "lucide-react";
import { ASSISTANT_PATH } from "@/components/assistant/assistant-provider";
import { ChatBubble } from "@/components/assistant/chat-bubble";
import { ChatPanel } from "@/components/assistant/chat-panel";
import { NotificationBell } from "@/components/assistant/notification-bell";
import { Button } from "@/components/ui/button";
import { showClaudeColumn } from "@/lib/navigation";
import { cn } from "@/lib/cn";
import { BottomBar } from "./bottom-bar";
import { ClaudeColumn } from "./claude-column";
import { HeaderTitle } from "./header-title";
import { MobileHeader } from "./mobile-header";
import { Sidebar } from "./sidebar";
import { useClaudeColumnCollapsed, useWideScreen } from "./use-claude-column";

/**
 * En-tête de la zone de contenu (≥ 768 px) : titre, réouverture de la colonne Claude, cloche. Sur
 * l'accueil, la salutation est le titre de la page : l'en-tête n'en affiche pas de second.
 */
function ContentHeader({ onExpand, showTitle }: { onExpand: () => void; showTitle: boolean }) {
  return (
    <header className="sticky top-0 z-30 hidden bg-bg/85 backdrop-blur-md md:block">
      <div className="mx-auto flex h-(--content-header-h) w-full max-w-6xl items-center gap-2 px-6 md:px-10">
        {showTitle ? (
          <HeaderTitle className="mr-auto min-w-0 text-sm font-semibold text-muted" />
        ) : (
          <span aria-hidden className="mr-auto" />
        )}
        <Button variant="secondary" size="sm" onClick={onExpand} className="claude-expand">
          <PanelRightOpen aria-hidden />
          Afficher Claude
        </Button>
        <NotificationBell placement="dropdown" />
      </div>
    </header>
  );
}

/**
 * Mise en page de l'application : barre latérale (≥ 768 px), en-tête et barre du bas (téléphone),
 * contenu, colonne Claude (≥ 1280 px, repliable) ou bulle + panneau.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useClaudeColumnCollapsed();
  const wide = useWideScreen();
  const hostsColumn = pathname !== ASSISTANT_PATH;
  const columnActive = showClaudeColumn({ wide, collapsed, pathname });
  const focusAfter = useRef<"expand" | "column" | null>(null);

  // Le CSS de la mise en page lit l'état replié sur <html> (posé avant l'affichage au chargement).
  useEffect(() => {
    const root = document.documentElement;
    if (collapsed) root.dataset.claudeColumn = "collapsed";
    else delete root.dataset.claudeColumn;
    // Le bouton actionné disparaît : le focus passe à son pendant.
    const target = focusAfter.current;
    focusAfter.current = null;
    if (target === "expand") document.querySelector<HTMLElement>(".claude-expand")?.focus();
    else if (target === "column") document.querySelector<HTMLElement>("[data-claude-column-frame]")?.focus();
  }, [collapsed]);

  const collapse = useCallback(() => {
    focusAfter.current = "expand";
    setCollapsed(true);
  }, [setCollapsed]);

  const expand = useCallback(() => {
    focusAfter.current = "column";
    setCollapsed(false);
  }, [setCollapsed]);

  return (
    <div className={cn("min-h-dvh md:pl-60 lg:pl-64", hostsColumn && "shell-claude")}>
      <a
        href="#contenu"
        className="fixed left-4 top-4 z-50 -translate-y-24 rounded-full bg-surface px-4 py-2.5 text-sm font-semibold text-fg shadow-pop transition-transform focus:translate-y-0"
      >
        Aller au contenu
      </a>
      <Sidebar />
      <div className="pr-[var(--claude-column-width,0px)]">
        <MobileHeader />
        <ContentHeader onExpand={expand} showTitle={pathname !== "/"} />
        <main
          id="contenu"
          tabIndex={-1}
          className="mx-auto w-full max-w-6xl px-4 pb-[calc(10rem+env(safe-area-inset-bottom))] pt-5 outline-none sm:px-6 md:px-10 md:pb-28 md:pt-4"
        >
          {children}
        </main>
      </div>
      {hostsColumn && <ClaudeColumn active={columnActive} onCollapse={collapse} />}
      <BottomBar />
      <ChatBubble />
      <ChatPanel />
    </div>
  );
}
