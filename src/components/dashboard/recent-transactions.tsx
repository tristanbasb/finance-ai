import Link from "next/link";
import { ArrowRight, ReceiptText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { QuickAddButton } from "@/components/quick-add/quick-add-button";
import { buttonClasses } from "@/components/ui/button";
import { Amount } from "@/components/amount";
import { CategoryIcon } from "@/components/category-icon";
import type { TransactionRow } from "@/lib/queries/transactions";
import { formatDateShort } from "@/lib/format";

/** Les dernières transactions, toutes catégories confondues. */
export function RecentTransactions({ transactions }: { transactions: TransactionRow[] }) {
  return (
    <Card className="h-full">
      <CardHeader
        action={
          transactions.length > 0 && (
            <Link
              href="/transactions"
              className={buttonClasses({ variant: "ghost", size: "sm", className: "-mr-2 -mt-1" })}
            >
              Tout voir
              <ArrowRight aria-hidden />
            </Link>
          )
        }
      >
        <CardTitle>Dernières transactions</CardTitle>
      </CardHeader>
      <CardContent>
        {transactions.length === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title="Aucune transaction"
            description="Saisissez une dépense ou importez un relevé bancaire au format CSV."
            action={
              <QuickAddButton variant="secondary" size="sm" />
            }
          />
        ) : (
          <ul className="-mx-2">
            {transactions.map((t) => (
              <li key={t.id} className="flex items-center gap-3 rounded-lg px-2 py-2.5">
                <CategoryIcon icon={t.categoryIcon} color={t.categoryColor} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg">{t.label}</p>
                  <p className="truncate text-[12px] text-muted">
                    {t.categoryName ?? "Sans catégorie"} · {t.accountName}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <Amount cents={t.amount} tone="signed" className="text-sm font-medium" />
                  <p className="num text-[12px] text-subtle">{formatDateShort(t.date)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
