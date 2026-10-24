import { cn } from "@/lib/cn";

/** Logo : une courbe montante dans un carré à l'accent. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-8", className)}>
      <rect width="32" height="32" rx="9" fill="var(--accent)" />
      <path
        d="M8 20.5 13.2 15.2l3.9 3.4L24 11.5"
        fill="none"
        stroke="var(--accent-fg)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="24" cy="11.5" r="2.2" fill="var(--accent-fg)" />
    </svg>
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
