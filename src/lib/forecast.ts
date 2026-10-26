import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { categories, recurringPayments } from "@/lib/db/schema";
import { todayLocal } from "@/lib/dates";
import { listAccountsWithBalances } from "@/lib/queries/accounts";
import { listRecurring, type Recurring } from "@/lib/queries/recurring";
import { getForecastMargin } from "@/lib/settings";

export type RecurringStatus = "due" | "paid" | "skipped";

export type MonthRecurring = {
  id: number;
  label: string;
  amount: number;
  categoryId: number | null;
  categoryName: string | null;
  accountId: number;
  accountName: string;
  frequency: Recurring["frequency"];
  anchorMonth: number | null;
  status: RecurringStatus;
  transactionId: number | null;
  /** Vrai si le montant entre dans la prévision (à payer, sur un compte courant non archivé). */
  inForecast: boolean;
};

/** Mois `YYYY-MM` d'une date `YYYY-MM-DD` (aujourd'hui par défaut). */
export function currentPeriod(today: string = todayLocal()): string {
  return today.slice(0, 7);
}

/** La récurrente tombe-t-elle ce mois-là ? Une récurrente en pause n'est jamais due. */
export function isDue(
  r: { frequency: Recurring["frequency"]; anchorMonth: number | null; active: boolean },
  period: string,
): boolean {
  if (!r.active) return false;
  const month = Number(period.slice(5, 7));
  if (r.frequency === "monthly") return true;
  if (r.anchorMonth === null) return false;
  if (r.frequency === "quarterly") return (((month - r.anchorMonth) % 3) + 3) % 3 === 0;
  return month === r.anchorMonth;
}

/** Récurrentes actives et dues pour `period`, avec leur statut (à payer, payée, passée). */
export function monthRecurring(db: Db, period: string): MonthRecurring[] {
  const accounts = new Map(listAccountsWithBalances(db).map((a) => [a.id, a]));
  const categoryNames = new Map(db.select().from(categories).all().map((c) => [c.id, c.name]));
  const payments = new Map(
    db
      .select()
      .from(recurringPayments)
      .where(eq(recurringPayments.period, period))
      .all()
      .map((p) => [p.recurringId, p]),
  );
  return listRecurring(db)
    .filter((r) => isDue(r, period))
    .map((r) => {
      const payment = payments.get(r.id);
      const status: RecurringStatus = !payment ? "due" : payment.skipped ? "skipped" : "paid";
      const account = accounts.get(r.accountId);
      return {
        id: r.id,
        label: r.label,
        amount: r.amount,
        categoryId: r.categoryId,
        categoryName: r.categoryId === null ? null : (categoryNames.get(r.categoryId) ?? null),
        accountId: r.accountId,
        accountName: account?.name ?? "",
        frequency: r.frequency,
        anchorMonth: r.anchorMonth,
        status,
        transactionId: payment?.transactionId ?? null,
        inForecast: status === "due" && account?.type === "checking" && !account.archived,
      };
    });
}

/** Fin de mois prévue : solde des comptes courants moins les récurrentes encore à payer. */
export function forecastFor(
  db: Db,
  period: string,
): { checkingBalance: number; dueTotal: number; forecast: number; margin: number; items: MonthRecurring[] } {
  const checkingBalance = listAccountsWithBalances(db)
    .filter((a) => a.type === "checking" && !a.archived)
    .reduce((sum, a) => sum + a.balance, 0);
  const items = monthRecurring(db, period);
  const dueTotal = items.filter((i) => i.inForecast).reduce((sum, i) => sum + i.amount, 0);
  return { checkingBalance, dueTotal, forecast: checkingBalance - dueTotal, margin: getForecastMargin(db), items };
}

/** Peut-on s'offrir `price` (centimes) en gardant la marge ? */
export function canAfford(
  forecast: number,
  margin: number,
  price: number,
): { ok: boolean; remaining: number; missing: number } {
  const remaining = forecast - price;
  return { ok: remaining >= margin, remaining, missing: Math.max(0, margin - remaining) };
}
