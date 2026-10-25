"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { useQuickAdd } from "@/components/quick-add/quick-add-provider";
import { isActive, NAV_ITEMS, type NavItem } from "@/components/nav-items";

function Tab({ item, active }: { item: NavItem; active: boolean }) {
  const { href, label, icon: Icon } = item;
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
          "focus-visible:outline-offset-[-4px]",
          active ? "text-brand" : "text-muted hover:text-fg",
        )}
      >
        {/* Pastille derrière l'icône active (forme visible même sans la couleur). */}
        <span
          aria-hidden
          className={cn(
            "inline-flex h-7 w-12 items-center justify-center rounded-full transition-colors duration-200",
            active ? "bg-brand-soft" : "group-hover:bg-surface-2",
          )}
        >
          <Icon className="size-5" strokeWidth={active ? 2.2 : 1.8} />
        </span>
        <span className="leading-none">{label}</span>
      </Link>
    </li>
  );
}

/**
 * Barre du bas du téléphone (< 768 px) : 2 rubriques, le « + » central surélevé en dégradé
 * (saisie rapide), 2 rubriques. Respecte la zone sûre du bas de l'écran.
 */
export function BottomBar() {
  const pathname = usePathname();
  const { open } = useQuickAdd();
  // Le « + » s'insère au milieu des rubriques.
  const half = Math.ceil(NAV_ITEMS.length / 2);
  const tabs = (items: readonly NavItem[]) =>
    items.map((item) => <Tab key={item.href} item={item} active={isActive(pathname, item.href)} />);

  return (
    <nav
      aria-label="Navigation principale"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
    >
      <ul className="mx-auto grid h-[4.5rem] max-w-md grid-cols-5">
        {tabs(NAV_ITEMS.slice(0, half))}
        <li className="flex items-start justify-center">
          <button
            type="button"
            onClick={() => open()}
            aria-label="Ajouter une opération"
            title="Ajouter une opération"
            className={cn(
              "-mt-5 inline-flex size-16 items-center justify-center rounded-full bg-brand-gradient text-white shadow-glow",
              // Anneau de la couleur de la barre : le bouton semble posé dessus.
              "ring-[5px] ring-surface",
              "transition-[scale,filter] duration-150 hover:brightness-110 active:scale-95",
              "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring",
            )}
          >
            <Plus aria-hidden className="size-7" strokeWidth={2.4} />
          </button>
        </li>
        {tabs(NAV_ITEMS.slice(half))}
      </ul>
    </nav>
  );
}
