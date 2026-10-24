import { z } from "zod";
import { ACCOUNT_TYPES, ASSET_TYPES, CATEGORY_KINDS } from "@/lib/db/schema";

// Pas de `.default()` ici : avec `.partial()` (PATCH) un défaut réécraserait la valeur existante.
// Les valeurs par défaut sont portées par les colonnes SQLite.

const name = z.string().trim().min(1).max(200);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const cents = z.number().int();
const id = z.number().int().positive();

function isRealDate(s: string): boolean {
  const [y, m, d] = s.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isRealDate, "Date invalide");

export const monthString = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const accountInput = z.object({
  name,
  type: z.enum(ACCOUNT_TYPES),
  initialBalance: cents.optional(),
  color: color.optional(),
  archived: z.boolean().optional(),
});

export const categoryInput = z.object({
  name,
  kind: z.enum(CATEGORY_KINDS),
  color,
  icon: z.string().trim().min(1).max(50),
  monthlyBudget: z.number().int().nonnegative().nullable().optional(),
});

export const transactionInput = z.object({
  accountId: id,
  categoryId: id.nullable().optional(),
  date: isoDate,
  amount: cents,
  label: name,
  note: z.string().trim().max(1000).nullable().optional(),
});

export const goalInput = z.object({
  name,
  targetAmount: z.number().int().positive(),
  accountId: id.nullable().optional(),
  currentAmount: z.number().int().nonnegative().optional(),
  deadline: isoDate.nullable().optional(),
  color: color.optional(),
});

export const holdingInput = z.object({
  accountId: id,
  symbol: z
    .string()
    .trim()
    .min(1)
    .max(30)
    .transform((s) => s.toUpperCase()),
  name,
  assetType: z.enum(ASSET_TYPES),
  quantity: z.number().positive(),
  // Prix unitaires : réels en centimes (fractions permises).
  avgPrice: z.number().nonnegative(),
  manualPrice: z.number().nonnegative().nullable().optional(),
  currency: z.string().trim().min(1).max(10).optional(),
});

export const importInput = z.object({
  accountId: id,
  rows: z
    .array(
      z.object({
        date: isoDate,
        label: name,
        amount: cents,
        categoryId: id.nullable().optional(),
      }),
    )
    .min(1)
    .max(5000),
});

export const transactionFilters = z.object({
  month: monthString.optional(),
  accountId: z.coerce.number().int().positive().optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(2000).optional(),
});

export type AccountInput = z.infer<typeof accountInput>;
export type CategoryInput = z.infer<typeof categoryInput>;
export type TransactionInput = z.infer<typeof transactionInput>;
export type GoalInput = z.infer<typeof goalInput>;
export type HoldingInput = z.infer<typeof holdingInput>;
export type ImportInput = z.infer<typeof importInput>;
export type TransactionFilters = z.infer<typeof transactionFilters>;
