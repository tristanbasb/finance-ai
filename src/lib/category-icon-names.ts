// Noms des icônes de catégorie proposées par l'interface (lucide, en kebab-case). Module pur :
// utilisable côté serveur (outils d'écriture de Claude) sans charger lucide-react.
// `src/components/category-icon.tsx` associe chaque nom à son composant (test de concordance).

export const CATEGORY_ICON_NAMES = [
  "shopping-cart",
  "home",
  "car",
  "gamepad-2",
  "heart-pulse",
  "repeat",
  "shopping-bag",
  "utensils",
  "plane",
  "circle-ellipsis",
  "briefcase",
  "coins",
  "wallet",
  "piggy-bank",
  "trending-up",
  "gift",
  "graduation-cap",
  "baby",
  "paw-print",
  "shirt",
  "fuel",
  "train",
  "zap",
  "smartphone",
  "book-open",
  "dumbbell",
  "tag",
] as const;

export type CategoryIconName = (typeof CATEGORY_ICON_NAMES)[number];
