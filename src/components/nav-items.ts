import {
  ArrowLeftRight,
  Bot,
  ChartLine,
  LayoutDashboard,
  type LucideIcon,
  PiggyBank,
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
  { href: "/savings", label: "Épargne", shortLabel: "Épargne", icon: PiggyBank, primary: true },
  { href: "/investments", label: "Investissements", shortLabel: "Invest.", icon: ChartLine, primary: true },
  { href: "/assistant", label: "Assistant", shortLabel: "Assistant", icon: Bot, primary: true },
  { href: "/settings", label: "Réglages", shortLabel: "Réglages", icon: Settings, primary: false },
];

/** Vrai si `pathname` relève de la rubrique `href` (« / » ne correspond qu'à lui-même). */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
