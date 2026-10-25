import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { shiftMonth } from "@/lib/budget-month";
import { formatMonth } from "@/lib/format";

function href(month: string, currentMonth: string): string {
  return month === currentMonth ? "/budgets" : `/budgets?month=${month}`;
}

/** Navigation de mois ‹ Octobre 2026 › ; le mois en cours est l'adresse sans paramètre. */
export function BudgetMonthNav({ month, currentMonth }: { month: string; currentMonth: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <nav aria-label="Mois" className="flex items-center gap-1">
        <Link
          href={href(shiftMonth(month, -1), currentMonth)}
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
          {formatMonth(month)}
        </h2>
        <Link
          href={href(shiftMonth(month, 1), currentMonth)}
          aria-label="Mois suivant"
          className={buttonClasses({ variant: "secondary", size: "icon" })}
          scroll={false}
        >
          <ChevronRight aria-hidden />
        </Link>
      </nav>
      {month !== currentMonth && (
        <Link href="/budgets" className={buttonClasses({ variant: "ghost", size: "sm" })} scroll={false}>
          Mois en cours
        </Link>
      )}
    </div>
  );
}
