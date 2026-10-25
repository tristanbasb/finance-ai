import Link from "next/link";
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { tintStyle } from "@/lib/category-tint";

export type ChipTint = { bg: string; fg: string };

type ChipOwnProps = {
  /** État sélectionné (filtre actif) : dégradé de marque, ou anneau si la pastille est teintée. */
  selected?: boolean;
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
    // 36 px de haut visuellement, zone tactile étendue à 44 px par le pseudo-élément.
    "relative inline-flex h-9 shrink-0 select-none items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold",
    "after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']",
    "transition-[background-color,border-color,color,box-shadow,filter] duration-150",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    "disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
    selected && !tinted && "border border-transparent bg-brand-gradient text-white shadow-glow hover:brightness-110",
    selected && tinted && "tint border border-transparent ring-2 ring-current ring-inset",
    !selected && tinted && "tint border border-transparent hover:brightness-95 dark:hover:brightness-110",
    !selected && !tinted && "border border-border bg-surface text-muted hover:border-border-strong hover:text-fg",
    className,
  );
}

/** Pastille de filtre ou de catégorie : bouton (`onClick`) ou lien (`href`). */
export function Chip(props: ChipProps) {
  const { selected = false, tint, tintColor, icon: Icon, children, className } = props;
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
  const { selected: _s, tint: _t, tintColor: _c, icon: _i, children: _ch, className: _cl, href: _h, type = "button", ...rest } =
    props;
  return (
    <button type={type} aria-pressed={selected} className={classes} style={style} {...rest}>
      {content}
    </button>
  );
}
