import { House, Landmark, PieChart, ReceiptText, type LucideIcon } from "lucide-react";

export { isActive } from "@/lib/navigation";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

/** Les 4 rubriques de la navigation principale (barre latérale et barre du bas). */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Accueil", icon: House },
  { href: "/transactions", label: "Activité", icon: ReceiptText },
  { href: "/patrimoine", label: "Patrimoine", icon: Landmark },
  { href: "/budgets", label: "Budgets", icon: PieChart },
];
