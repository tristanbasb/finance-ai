import type { Metadata } from "next";
import { getDb } from "@/lib/db";
import { todayLocal } from "@/lib/dates";
import { listAccountsWithBalances } from "@/lib/queries/accounts";
import { listCategories } from "@/lib/queries/categories";
import { listTransactions } from "@/lib/queries/transactions";
import { monthString } from "@/lib/validation";
import { TransactionList } from "@/components/transactions/transaction-list";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Transactions" };

const READ_LIMIT = 2000;

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function positiveInt(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const today = todayLocal();
  const currentMonth = today.slice(0, 7);

  // Filtres lus dans l'adresse ; une valeur illisible retombe sur la valeur par défaut.
  const monthParam = first(params.month);
  const month = monthParam !== undefined && monthString.safeParse(monthParam).success ? monthParam : currentMonth;
  const accountId = positiveInt(first(params.accountId));
  const categoryId = positiveInt(first(params.categoryId));
  const q = (first(params.q) ?? "").slice(0, 200);

  const db = getDb();
  const transactions = listTransactions(db, {
    month,
    accountId: accountId ?? undefined,
    categoryId: categoryId ?? undefined,
    q,
    limit: READ_LIMIT,
  });
  const accounts = listAccountsWithBalances(db).map((a) => ({ id: a.id, name: a.name, archived: a.archived }));
  const categories = listCategories(db).map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    color: c.color,
    icon: c.icon,
  }));

  return (
    <TransactionList
      transactions={transactions}
      accounts={accounts}
      categories={categories}
      filters={{ month, accountId, categoryId, q }}
      currentMonth={currentMonth}
      today={today}
      truncated={transactions.length >= READ_LIMIT}
    />
  );
}
