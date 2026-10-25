"use client";

import { NotificationBell } from "@/components/assistant/notification-bell";
import { HeaderTitle } from "./header-title";
import { UserMenu } from "./user-menu";

/**
 * En-tête compact du téléphone (< 768 px) : salutation ou titre, cloche, menu du compte. Au-dessus
 * de la barre du bas et de la bulle (z-30) pour que ses menus ne soient jamais recouverts.
 */
export function MobileHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-bg/85 pt-[env(safe-area-inset-top)] backdrop-blur-md md:hidden">
      <div className="flex h-14 items-center gap-2 pl-4 pr-2">
        <HeaderTitle className="mr-auto min-w-0 text-[17px] font-bold tracking-[-0.02em] text-fg" />
        <NotificationBell placement="sheet" />
        <UserMenu />
      </div>
    </header>
  );
}
