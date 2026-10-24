import type { ACCOUNT_TYPES, CATEGORY_KINDS } from "@/lib/db/schema";

export type AccountType = (typeof ACCOUNT_TYPES)[number];
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

/** Compte tel que reçu du serveur, avec son solde actuel (centimes). */
export type AccountRow = {
  id: number;
  name: string;
  type: AccountType;
  initialBalance: number;
  color: string;
  archived: boolean;
  balance: number;
};

export type CategoryRow = {
  id: number;
  name: string;
  kind: CategoryKind;
  color: string;
  icon: string;
  monthlyBudget: number | null;
};

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: "Courant",
  savings: "Épargne",
  investment: "Investissement",
  crypto: "Crypto",
  other: "Autre",
};
