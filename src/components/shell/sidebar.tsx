"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus, Settings, Sparkles, type LucideIcon } from "lucide-react";
import { badgeCount } from "@/lib/assistant-thread";
import { cn } from "@/lib/cn";
import { useAssistant } from "@/components/assistant/assistant-provider";
import { Brand } from "@/components/brand-mark";
import { LogoutButton } from "@/components/logout-button";
import { isActive, NAV_ITEMS } from "@/components/nav-items";
import { useQuickAdd } from "@/components/quick-add/quick-add-provider";
import { Button } from "@/components/ui/button";

function SideLink({
  href,
  label,
  icon: Icon,
  active,
  badge,
  quiet = false,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  /** Messages non lus (pastille). */
  badge?: number;
  /** Liens secondaires du bas : plus discrets. */
  quiet?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex h-10 items-center gap-3 rounded-xl px-3 text-sm transition-colors pointer-coarse:h-11",
        active
          ? "bg-brand-soft font-semibold text-brand"
          : cn("hover:bg-surface-2 hover:text-fg", quiet ? "text-muted" : "font-medium text-fg/80"),
      )}
    >
      <Icon
        aria-hidden
        className={cn("size-[18px] shrink-0", active ? "text-brand" : "text-subtle group-hover:text-muted")}
        strokeWidth={active ? 2.2 : 1.9}
      />
      <span className="truncate">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span aria-hidden className="num ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[11px] font-semibold text-white dark:text-bg">
          {badgeCount(badge)}
        </span>
      )}
      {badge !== undefined && badge > 0 && (
        <span className="sr-only">
          , {badge} message{badge > 1 ? "s" : ""} non lu{badge > 1 ? "s" : ""}
        </span>
      )}
    </Link>
  );
}

/**
 * Barre latérale (≥ 768 px) : logo, « Ajouter » en dégradé (saisie rapide), les 4 rubriques, puis
 * Assistant, Réglages et déconnexion en bas.
 */
export function Sidebar() {
  const pathname = usePathname();
  const { open } = useQuickAdd();
  const { unread } = useAssistant();

  return (
    <div
      className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-surface px-3 pb-4 pt-5 md:flex lg:w-64"
    >
      <Link href="/" aria-label="Finance AI, accueil" className="mb-6 self-start rounded-xl px-2 py-1">
        <Brand />
      </Link>

      <Button size="lg" onClick={() => open()} className="mb-6 w-full rounded-2xl" title="Ajouter une opération (N)">
        <Plus aria-hidden className="size-5!" strokeWidth={2.4} />
        Ajouter
      </Button>

      <nav aria-label="Navigation principale" className="flex-1">
        <ul className="space-y-1">
          {NAV_ITEMS.map((item) => (
            <li key={item.href}>
              <SideLink {...item} active={isActive(pathname, item.href)} />
            </li>
          ))}
        </ul>
      </nav>

      <ul className="space-y-0.5 border-t border-border pt-3">
        <li>
          <SideLink
            href="/assistant"
            label="Assistant"
            icon={Sparkles}
            active={isActive(pathname, "/assistant")}
            badge={unread.count}
            quiet
          />
        </li>
        <li>
          <SideLink href="/settings" label="Réglages" icon={Settings} active={isActive(pathname, "/settings")} quiet />
        </li>
        <li>
          <LogoutButton />
        </li>
      </ul>
    </div>
  );
}
