import {
  ArrowLeftRight,
  Bot,
  LayoutDashboard,
  PieChart,
  Landmark,
  type LucideIcon,
  Settings,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  /** Libellé court pour la barre d'onglets mobile. */
  shortLabel: string;
  icon: LucideIcon;
  /** Affiché dans la barre d'onglets mobile (sinon dans l'en-tête mobile). */
  primary: boolean;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Tableau de bord", shortLabel: "Accueil", icon: LayoutDashboard, primary: true },
  { href: "/transactions", label: "Transactions", shortLabel: "Transactions", icon: ArrowLeftRight, primary: true },
  { href: "/budgets", label: "Budgets", shortLabel: "Budgets", icon: PieChart, primary: true },
  { href: "/patrimoine", label: "Patrimoine", shortLabel: "Patrimoine", icon: Landmark, primary: true },
  { href: "/assistant", label: "Assistant", shortLabel: "Assistant", icon: Bot, primary: true },
  { href: "/settings", label: "Réglages", shortLabel: "Réglages", icon: Settings, primary: false },
];

/** Vrai si `pathname` relève de la rubrique `href` (« / » ne correspond qu'à lui-même). */
export function isActive(pathname: string, rawHref: string): boolean {
  const href = rawHref.split("#")[0];
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
