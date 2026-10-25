import type { ButtonHTMLAttributes } from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

const base =
  "inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold " +
  "transition-[background-color,border-color,color,box-shadow,filter,translate] duration-150 ease-out " +
  "active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring " +
  "disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";

const variants: Record<ButtonVariant, string> = {
  // Texte blanc sur le dégradé : ≥ 5,3:1 même sur l'extrémité violette.
  primary: "bg-brand-gradient text-white shadow-glow hover:brightness-110 active:brightness-95",
  secondary:
    "border border-border bg-surface text-fg shadow-soft hover:border-border-strong hover:bg-surface-2",
  ghost: "text-muted hover:bg-surface-2 hover:text-fg",
  danger: "bg-danger text-white hover:brightness-110 active:brightness-95 dark:text-bg",
};

// Sur écran tactile (pointeur grossier), la taille par défaut atteint 44 px.
const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3.5 text-[13px] pointer-coarse:h-11",
  md: "h-10 px-5 text-sm pointer-coarse:h-11",
  lg: "h-12 px-6 text-[15px]",
  icon: "size-10 pointer-coarse:size-11",
};

/** Classes d'un bouton : utilisable aussi sur un `<Link>` ou un `<a>`. */
export function buttonClasses({
  variant = "primary",
  size = "md",
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}): string {
  return cn(base, variants[variant], sizes[size], className);
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Affiche un indicateur et désactive le bouton. */
  loading?: boolean;
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className,
  children,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, className })}
      {...props}
    >
      {loading && <LoaderCircle aria-hidden className="animate-spin" />}
      {children}
    </button>
  );
}
