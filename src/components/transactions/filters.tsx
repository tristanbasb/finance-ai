"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Landmark, RotateCcw, Search, X } from "lucide-react";
import { categoryIconComponent } from "@/components/category-icon";
import { buttonClasses } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { controlClasses } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { formatMonth } from "@/lib/format";
import type { AccountOption, CategoryOption } from "./transaction-dialog";

export type FilterState = {
  /** Mois affiché, « YYYY-MM ». */
  month: string;
  accountId: number | null;
  categoryId: number | null;
  q: string;
};

/** Décale un mois « YYYY-MM » de `delta` mois. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** Adresse de la page pour un état de filtres ; les valeurs par défaut sont omises. */
export function filtersHref(pathname: string, f: FilterState, currentMonth: string): string {
  const params = new URLSearchParams();
  if (f.month !== currentMonth) params.set("month", f.month);
  if (f.accountId !== null) params.set("accountId", String(f.accountId));
  if (f.categoryId !== null) params.set("categoryId", String(f.categoryId));
  if (f.q.trim() !== "") params.set("q", f.q.trim());
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export type FiltersProps = FilterState & {
  currentMonth: string;
  accounts: AccountOption[];
  categories: CategoryOption[];
};

const SEARCH_DELAY_MS = 300;

/**
 * Champ de recherche de l'en-tête : la saisie est répercutée (avec délai) dans l'adresse de la page.
 * Un changement venu d'ailleurs (retour arrière, réinitialisation) remet le champ à jour.
 */
export function SearchField({ currentMonth, className, ...state }: FilterState & { currentMonth: string; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState(state.q);
  // Dernière valeur écrite dans l'adresse par la saisie : permet de distinguer une saisie en cours
  // d'un changement venu d'ailleurs.
  const pushedQ = useRef(state.q);

  useEffect(() => {
    if (state.q !== pushedQ.current) {
      pushedQ.current = state.q;
      setSearch(state.q);
    }
  }, [state.q]);

  const { month, accountId, categoryId } = state;
  useEffect(() => {
    const next = search.trim();
    if (next === pushedQ.current.trim()) return;
    const timer = setTimeout(() => {
      pushedQ.current = next;
      router.replace(filtersHref(pathname, { month, accountId, categoryId, q: next }, currentMonth), {
        scroll: false,
      });
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search, month, accountId, categoryId, pathname, currentMonth, router]);

  return (
    <div className={cn("relative", className)}>
      <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
      <input
        type="search"
        aria-label="Rechercher dans les libellés"
        placeholder="Rechercher un libellé"
        autoComplete="off"
        maxLength={200}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className={`${controlClasses} rounded-full [&::-webkit-search-cancel-button]:hidden`}
        style={{ paddingLeft: 38, paddingRight: search ? 40 : undefined }}
      />
      {search && (
        <button
          type="button"
          aria-label="Effacer la recherche"
          onClick={() => setSearch("")}
          className="absolute right-1.5 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-subtle hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
        >
          <X aria-hidden className="size-4" />
        </button>
      )}
    </div>
  );
}

const scrollRow =
  "-mx-4 -my-1.5 flex gap-2 overflow-x-auto px-4 py-2.5 [scrollbar-width:none] sm:-mx-6 sm:px-6 md:mx-0 md:my-0 md:flex-wrap md:overflow-visible md:px-0 md:py-1 [&::-webkit-scrollbar]:hidden";

/** Mois, compte et catégorie sous forme de pastilles, tous reflétés dans l'adresse de la page. */
export function Filters({ currentMonth, accounts, categories, ...state }: FiltersProps) {
  const pathname = usePathname();
  const href = (patch: Partial<FilterState>) => filtersHref(pathname, { ...state, ...patch }, currentMonth);
  const filtered = state.accountId !== null || state.categoryId !== null || state.q.trim() !== "";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Mois" className="flex items-center gap-1">
          <Link
            href={href({ month: shiftMonth(state.month, -1) })}
            aria-label="Mois précédent"
            className={buttonClasses({ variant: "secondary", size: "icon" })}
            scroll={false}
          >
            <ChevronLeft aria-hidden />
          </Link>
          <h2
            aria-live="polite"
            className="min-w-36 px-2 text-center text-[15px] font-bold tracking-[-0.01em] text-fg first-letter:uppercase"
          >
            {formatMonth(state.month)}
          </h2>
          <Link
            href={href({ month: shiftMonth(state.month, 1) })}
            aria-label="Mois suivant"
            className={buttonClasses({ variant: "secondary", size: "icon" })}
            scroll={false}
          >
            <ChevronRight aria-hidden />
          </Link>
        </nav>
        {state.month !== currentMonth && (
          <Link href={href({ month: currentMonth })} className={buttonClasses({ variant: "ghost", size: "sm" })} scroll={false}>
            Mois en cours
          </Link>
        )}
        {filtered && (
          <Link
            href={href({ accountId: null, categoryId: null, q: "" })}
            className={cn(buttonClasses({ variant: "ghost", size: "sm" }), "ml-auto")}
            scroll={false}
          >
            <RotateCcw aria-hidden />
            Réinitialiser les filtres
          </Link>
        )}
      </div>

      <nav aria-label="Filtrer par compte" className={scrollRow}>
        <Chip href={href({ accountId: null })} selected={state.accountId === null} icon={Landmark}>
          Tous les comptes
        </Chip>
        {accounts.map((a) => (
          <Chip key={a.id} href={href({ accountId: state.accountId === a.id ? null : a.id })} selected={state.accountId === a.id}>
            {a.archived ? `${a.name} (archivé)` : a.name}
          </Chip>
        ))}
      </nav>

      <nav aria-label="Filtrer par catégorie" className={scrollRow}>
        {categories.map((c) => (
          <Chip
            key={c.id}
            href={href({ categoryId: state.categoryId === c.id ? null : c.id })}
            selected={state.categoryId === c.id}
            tintColor={c.color}
            icon={categoryIconComponent(c.icon)}
          >
            {c.name}
          </Chip>
        ))}
      </nav>
    </div>
  );
}
