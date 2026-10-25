import {
  Baby,
  BookOpen,
  Briefcase,
  Car,
  CircleEllipsis,
  Coins,
  Dumbbell,
  Fuel,
  Gamepad2,
  Gift,
  GraduationCap,
  HeartPulse,
  House,
  type LucideIcon,
  PawPrint,
  PiggyBank,
  Plane,
  Repeat,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Tag,
  Train,
  TrendingUp,
  Utensils,
  Wallet,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { CATEGORY_ICON_NAMES as ICON_NAMES, type CategoryIconName as IconName } from "@/lib/category-icon-names";
import { tintStyle } from "@/lib/category-tint";

/** Icônes lucide utilisables pour une catégorie (nom kebab stocké en base → composant). */
const ICONS = {
  "shopping-cart": ShoppingCart,
  home: House,
  house: House,
  car: Car,
  "gamepad-2": Gamepad2,
  "heart-pulse": HeartPulse,
  repeat: Repeat,
  "shopping-bag": ShoppingBag,
  utensils: Utensils,
  plane: Plane,
  "circle-ellipsis": CircleEllipsis,
  briefcase: Briefcase,
  coins: Coins,
  wallet: Wallet,
  "piggy-bank": PiggyBank,
  "trending-up": TrendingUp,
  gift: Gift,
  "graduation-cap": GraduationCap,
  baby: Baby,
  "paw-print": PawPrint,
  shirt: Shirt,
  fuel: Fuel,
  train: Train,
  zap: Zap,
  smartphone: Smartphone,
  "book-open": BookOpen,
  dumbbell: Dumbbell,
  tag: Tag,
} satisfies Record<IconName | "house", LucideIcon>;

export type CategoryIconName = keyof typeof ICONS;

/** Noms proposés dans un sélecteur d'icône (sans l'alias `house`) : `src/lib/category-icon-names.ts`. */
export const CATEGORY_ICON_NAMES: readonly IconName[] = ICON_NAMES;

/** Composant lucide d'une icône de catégorie ; `Tag` si le nom est inconnu ou absent. */
export function categoryIconComponent(name: string | null | undefined): LucideIcon {
  return name && Object.hasOwn(ICONS, name) ? ICONS[name as CategoryIconName] : Tag;
}

export type CategoryIconProps = {
  icon: string | null | undefined;
  /** Couleur de la catégorie (#rrggbb) ; gris neutre si absente. */
  color?: string | null;
  /** Taille de la pastille. */
  size?: "sm" | "md" | "lg";
  /**
   * Pastille pastel calculée par `categoryTint` (fond mélangé à la surface, icône au
   * contraste AA), adaptée au clair et au sombre. Sinon, simple teinte transparente.
   */
  tinted?: boolean;
  className?: string;
};

const sizes = {
  sm: "size-7 [&_svg]:size-3.5",
  md: "size-9 [&_svg]:size-4",
  lg: "size-11 [&_svg]:size-5",
} as const;

/** Pastille ronde teintée de la couleur de la catégorie, avec son icône. */
export function CategoryIcon({ icon, color, size = "md", tinted = false, className }: CategoryIconProps) {
  const Icon = icon && Object.hasOwn(ICONS, icon) ? ICONS[icon as CategoryIconName] : Tag;
  const tint = color ?? "#94a3b8";
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full",
        sizes[size],
        tinted && "tint",
        className,
      )}
      style={
        tinted
          ? tintStyle(color)
          : { color: tint, backgroundColor: `color-mix(in srgb, ${tint} 14%, transparent)` }
      }
    >
      <Icon strokeWidth={2} />
    </span>
  );
}
