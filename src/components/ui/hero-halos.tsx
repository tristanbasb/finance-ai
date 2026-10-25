import { cn } from "@/lib/cn";

/**
 * Halos décoratifs des cartes en dégradé de marque. Opacités volontairement faibles : là où les
 * deux halos se chevauchent, un petit texte blanc sans pastille garde 4,5:1 sur l'extrémité
 * violette (contrôlé par tests/tokens.test.ts, qui lit les classes `bg-white/[…]` ci-dessous).
 */
export function HeroHalos({ second = "right" }: { second?: "right" | "left" }) {
  return (
    <>
      <span aria-hidden className="pointer-events-none absolute -right-16 -top-20 size-64 rounded-full bg-white/[0.07]" />
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute size-56 rounded-full bg-white/[0.03]",
          second === "right" ? "-bottom-24 right-24" : "-bottom-28 -left-10",
        )}
      />
    </>
  );
}
