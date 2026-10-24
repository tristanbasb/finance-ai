import { count } from "drizzle-orm";
import type { Db } from "./index";
import { accounts, categories } from "./schema";

type DefaultCategory = {
  name: string;
  kind: "expense" | "income";
  color: string;
  icon: string;
};

export const DEFAULT_CATEGORIES: readonly DefaultCategory[] = [
  { name: "Alimentation", kind: "expense", color: "#22c55e", icon: "shopping-cart" },
  { name: "Logement", kind: "expense", color: "#3b82f6", icon: "home" },
  { name: "Transport", kind: "expense", color: "#f59e0b", icon: "car" },
  { name: "Loisirs", kind: "expense", color: "#a855f7", icon: "gamepad-2" },
  { name: "Santé", kind: "expense", color: "#ef4444", icon: "heart-pulse" },
  { name: "Abonnements", kind: "expense", color: "#06b6d4", icon: "repeat" },
  { name: "Shopping", kind: "expense", color: "#ec4899", icon: "shopping-bag" },
  { name: "Restaurants", kind: "expense", color: "#f97316", icon: "utensils" },
  { name: "Voyages", kind: "expense", color: "#14b8a6", icon: "plane" },
  { name: "Autres", kind: "expense", color: "#94a3b8", icon: "circle-ellipsis" },
  { name: "Salaire", kind: "income", color: "#16a34a", icon: "briefcase" },
  { name: "Autres revenus", kind: "income", color: "#84cc16", icon: "coins" },
];

/** Insère les catégories par défaut (si aucune) et un compte courant (si aucun compte). Idempotent. */
export function seedDefaults(db: Db): void {
  db.transaction((tx) => {
    if ((tx.select({ n: count() }).from(categories).get()?.n ?? 0) === 0) {
      tx.insert(categories).values([...DEFAULT_CATEGORIES]).run();
    }
    if ((tx.select({ n: count() }).from(accounts).get()?.n ?? 0) === 0) {
      tx.insert(accounts)
        .values({ name: "Compte courant", type: "checking", initialBalance: 0, color: "#6366f1" })
        .run();
    }
  });
}
