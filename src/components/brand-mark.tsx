import { cn } from "@/lib/cn";

/**
 * Logo : une courbe montante blanche dans un carré arrondi au dégradé de marque.
 * Le dégradé est en CSS (pas de `<linearGradient>` à identifiant, qui casse quand une
 * autre copie du logo est masquée).
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-flex size-8 shrink-0 rounded-[28%] bg-brand-gradient shadow-glow", className)}
    >
      <svg viewBox="0 0 32 32" className="size-full">
        <path
          d="M8 20.5 13.2 15.2l3.9 3.4L24 11.5"
          fill="none"
          stroke="#ffffff"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="24" cy="11.5" r="2.2" fill="#ffffff" />
      </svg>
    </span>
  );
}

/** Logo + nom de l'application. */
export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <BrandMark />
      <span className="text-[15px] font-semibold tracking-[-0.02em] text-fg">Finance AI</span>
    </span>
  );
}
