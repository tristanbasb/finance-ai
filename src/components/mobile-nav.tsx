"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { NotificationBell } from "./assistant/notification-bell";
import { Brand } from "./brand-mark";
import { LogoutButton } from "./logout-button";
import { isActive, NAV_ITEMS } from "./nav-items";

/** En-tête mobile (< md) : logo, notifications, Réglages et Déconnexion. */
export function MobileHeader() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-bg/85 px-4 backdrop-blur-md md:hidden">
      <Link href="/" aria-label="Tableau de bord">
        <Brand />
      </Link>
      <div className="flex items-center gap-1">
        <NotificationBell align="right" />
        <nav aria-label="Compte" className="flex items-center gap-1">
          {NAV_ITEMS.filter((i) => !i.primary).map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-label={label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex size-9 items-center justify-center rounded-lg transition-colors hover:bg-surface-2",
                  active ? "text-accent" : "text-muted",
                )}
              >
                <Icon aria-hidden className="size-[18px]" />
              </Link>
            );
          })}
          <LogoutButton compact />
        </nav>
      </div>
    </header>
  );
}

/** Barre d'onglets en bas de l'écran (< md). */
export function MobileTabBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Navigation principale"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
    >
      <ul className="mx-auto grid h-16 max-w-md grid-cols-4">
        {NAV_ITEMS.filter((i) => i.primary).map(({ href, label, shortLabel, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-label={label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-full flex-col items-center justify-center gap-1 text-[11px] transition-colors",
                  active ? "font-medium text-accent" : "text-muted hover:text-fg",
                )}
              >
                <Icon aria-hidden className="size-5" strokeWidth={active ? 2.2 : 1.8} />
                <span aria-hidden>{shortLabel}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
