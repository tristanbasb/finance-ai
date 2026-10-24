"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { controlClasses } from "@/components/ui/field";
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

/** Mois, compte, catégorie et recherche, tous reflétés dans l'adresse de la page. */
export function Filters({ currentMonth, accounts, categories, ...state }: FiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const href = (patch: Partial<FilterState>) => filtersHref(pathname, { ...state, ...patch }, currentMonth);

  const [search, setSearch] = useState(state.q);
  // Dernière valeur écrite dans l'adresse par la saisie : permet de distinguer une saisie en cours
  // d'un changement venu d'ailleurs (retour arrière du navigateur, réinitialisation).
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

  const filtered =
    state.accountId !== null || state.categoryId !== null || state.q.trim() !== "" || search.trim() !== "";

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
            className="min-w-36 px-2 text-center text-[15px] font-semibold tracking-[-0.01em] text-fg first-letter:uppercase"
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
          <Link
            href={href({ month: currentMonth })}
            className={buttonClasses({ variant: "ghost", size: "sm" })}
            scroll={false}
          >
            Mois en cours
          </Link>
        )}
        {filtered && (
          <button
            type="button"
            onClick={() => {
              pushedQ.current = "";
              setSearch("");
              router.push(filtersHref(pathname, { month: state.month, accountId: null, categoryId: null, q: "" }, currentMonth), {
                scroll: false,
              });
            }}
            className="ml-auto text-[13px] font-medium text-accent hover:underline"
          >
            Réinitialiser les filtres
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.4fr]">
        <Select
          aria-label="Filtrer par compte"
          value={state.accountId === null ? "" : String(state.accountId)}
          onChange={(e) =>
            router.push(href({ accountId: e.target.value === "" ? null : Number(e.target.value) }), {
              scroll: false,
            })
          }
          options={accounts.map((a) => ({ value: a.id, label: a.archived ? `${a.name} (archivé)` : a.name }))}
          placeholder="Tous les comptes"
        />
        <Select
          aria-label="Filtrer par catégorie"
          value={state.categoryId === null ? "" : String(state.categoryId)}
          onChange={(e) =>
            router.push(href({ categoryId: e.target.value === "" ? null : Number(e.target.value) }), {
              scroll: false,
            })
          }
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
          placeholder="Toutes les catégories"
        />
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle"
          />
          <input
            type="search"
            aria-label="Rechercher dans les libellés"
            placeholder="Rechercher un libellé"
            autoComplete="off"
            maxLength={200}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${controlClasses} [&::-webkit-search-cancel-button]:hidden`}
            style={{ paddingLeft: 36, paddingRight: search ? 36 : undefined }}
          />
          {search && (
            <button
              type="button"
              aria-label="Effacer la recherche"
              onClick={() => setSearch("")}
              className="absolute right-1.5 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-subtle hover:bg-surface-2 hover:text-fg"
            >
              <X aria-hidden className="size-4" />
            </button>
          )}
        </div>
      </div>

    </div>
  );
}
