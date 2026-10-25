import Link from "next/link";
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { tintStyle } from "@/lib/category-tint";

export type ChipTint = { bg: string; fg: string };

type ChipOwnProps = {
  /**
   * État sélectionné (filtre actif) : dégradé de marque, ou anneau si la pastille est teintée.
   * Sur un bouton, le fournir en fait une bascule (`aria-pressed`) ; l'omettre laisse un bouton
   * simple (ex. phrase d'exemple).
   */
  selected?: boolean;
  /** Navigation par rubrique : rubrique en cours (`aria-current`, même rendu que `selected`). */
  current?: boolean;
  /** Teinte explicite (ex. `categoryTint(color, scheme)`). */
  tint?: ChipTint;
  /** Couleur de catégorie (#rrggbb) : teinte pastel calculée pour le clair et le sombre. */
  tintColor?: string | null;
  /** Icône lucide en tête. */
  icon?: LucideIcon;
  children?: ReactNode;
  className?: string;
};

export type ChipProps = ChipOwnProps &
  (
    | ({ href: string } & { onClick?: never; type?: never; disabled?: never })
    | ({ href?: undefined } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof ChipOwnProps>)
  );

/** Classes d'une pastille ; `tinted` : la couleur vient d'une teinte de catégorie. */
export function chipClasses({
  selected = false,
  tinted = false,
  className,
}: { selected?: boolean; tinted?: boolean; className?: string } = {}): string {
  return cn(
    // 36 px au pointeur fin, 44 px (h-11) au pointeur grossier.
    "relative inline-flex h-9 pointer-coarse:h-11 shrink-0 select-none items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold",
    "transition-[background-color,border-color,color,box-shadow,filter] duration-150",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    "disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
    selected && !tinted && "border border-transparent bg-brand-gradient text-white shadow-glow hover:brightness-110",
    selected && tinted && "tint border border-transparent ring-2 ring-current ring-inset",
    // Survol : seul l'anneau change (aucun filtre, le texte garde son contraste AA).
    !selected && tinted && "tint border border-transparent hover:ring-2 hover:ring-inset hover:ring-(--tint-ring)",
    !selected && !tinted && "border border-border bg-surface text-muted hover:border-border-strong hover:text-fg",
    className,
  );
}

/** Pastille de filtre ou de catégorie : bouton (`onClick`) ou lien (`href`). */
export function Chip(props: ChipProps) {
  const { tint, tintColor, icon: Icon, children, className } = props;
  const selected = props.selected ?? props.current ?? false;
  const tinted = Boolean(tint || tintColor);
  const style: CSSProperties | undefined = tint
    ? ({
        "--tint-bg-light": tint.bg,
        "--tint-fg-light": tint.fg,
        "--tint-bg-dark": tint.bg,
        "--tint-fg-dark": tint.fg,
      } as CSSProperties)
    : tintColor
      ? (tintStyle(tintColor) as CSSProperties)
      : undefined;
  const classes = chipClasses({ selected, tinted, className });
  const content = (
    <>
      {Icon && <Icon aria-hidden />}
      {children}
    </>
  );

  if (props.href !== undefined) {
    return (
      <Link href={props.href} aria-current={selected ? "true" : undefined} className={classes} style={style}>
        {content}
      </Link>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { selected: _s, current, tint: _t, tintColor: _c, icon: _i, children: _ch, className: _cl, href: _h, type = "button", ...rest } =
    props;
  const state =
    current !== undefined ? { "aria-current": current ? ("true" as const) : undefined } : { "aria-pressed": props.selected };
  return (
    <button type={type} {...state} className={classes} style={style} {...rest}>
      {content}
    </button>
  );
}
