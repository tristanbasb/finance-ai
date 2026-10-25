import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { Amount } from "@/components/amount";
import { CategoryIcon } from "@/components/category-icon";
import type { TransactionRow } from "@/lib/queries/transactions";
import { formatDateShort } from "@/lib/format";

/**
 * « Dernières opérations » de l'accueil (5 au plus). Sans aucune opération, l'accueil affiche le
 * bloc de démarrage à la place.
 */
export function RecentTransactions({
  transactions,
  className,
}: {
  transactions: TransactionRow[];
  className?: string;
}) {
  return (
    <section aria-labelledby="home-recent-title" className={className}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="home-recent-title" className="text-[17px] font-bold tracking-[-0.02em] text-fg">
          Dernières opérations
        </h2>
        <Link
          href="/transactions"
          className={buttonClasses({
            variant: "ghost",
            size: "sm",
            className: "-mr-2",
          })}
        >
          Tout voir
          <ArrowRight aria-hidden />
        </Link>
      </div>
      <ul className="divide-y divide-border rounded-card border border-border bg-surface px-2 shadow-soft sm:px-3">
        {transactions.map((t) => (
          <li key={t.id} className="flex items-center gap-3 px-2 py-3">
            <CategoryIcon icon={t.categoryIcon} color={t.categoryColor} tinted />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-fg">{t.label}</p>
              <p className="truncate text-[12px] text-muted">
                {t.categoryName ?? "Sans catégorie"} · {t.accountName}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <Amount cents={t.amount} tone="signed" className="text-sm font-semibold" />
              <p className="num text-[12px] text-subtle">{formatDateShort(t.date)}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
