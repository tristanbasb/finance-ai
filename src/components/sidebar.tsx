"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { NotificationBell } from "./assistant/notification-bell";
import { Brand } from "./brand-mark";
import { LogoutButton } from "./logout-button";
import { isActive, NAV_ITEMS } from "./nav-items";

/** Navigation latérale (écrans ≥ md). */
export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-bg px-3 py-5 md:flex">
      <div className="mb-8 flex items-center justify-between gap-2">
        <Link href="/" className="rounded-lg px-2 py-1">
          <Brand />
        </Link>
        <NotificationBell />
      </div>
      <nav aria-label="Navigation principale" className="flex-1">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex h-9 items-center gap-3 rounded-lg px-3 text-sm transition-colors",
                    active
                      ? "bg-surface font-medium text-fg shadow-[inset_0_0_0_1px_var(--border)]"
                      : "text-muted hover:bg-surface-2 hover:text-fg",
                  )}
                >
                  <Icon
                    aria-hidden
                    className={cn(
                      "size-[18px] transition-colors",
                      active ? "text-accent" : "text-subtle group-hover:text-muted",
                    )}
                  />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t border-border pt-3">
        <LogoutButton />
      </div>
    </aside>
  );
}
