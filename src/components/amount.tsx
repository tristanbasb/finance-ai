import { formatEUR } from "@/lib/money";
import { cn } from "@/lib/cn";
import { NARROW_NBSP } from "@/lib/format";

export type AmountProps = {
  /** Montant en centimes (signé). */
  cents: number;
  /**
   * `signed` : « + » et couleur positive pour les entrées, « − » pour les sorties (encre neutre).
   * `plain` (défaut) : montant brut, sans couleur.
   */
  tone?: "plain" | "signed";
  className?: string;
};

/** Montant en euros, chiffres tabulaires. Les dépenses restent à l'encre neutre (pas de rouge). */
export function Amount({ cents, tone = "plain", className }: AmountProps) {
  if (tone === "signed") {
    const text = formatEUR(Math.abs(cents));
    const sign = cents > 0 ? "+" : cents < 0 ? "−" : "";
    return (
      <span className={cn("num whitespace-nowrap", cents > 0 && "text-positive", className)}>
        {sign}
        {sign && NARROW_NBSP}
        {text}
      </span>
    );
  }
  return <span className={cn("num whitespace-nowrap", className)}>{formatEUR(cents)}</span>;
}

/** Sépare « 12 345,67 € » en partie entière et « ,67 € » pour une mise en forme typographique. */
export function splitEUR(cents: number): { whole: string; rest: string } {
  const text = formatEUR(cents);
  const i = text.lastIndexOf(",");
  return i < 0 ? { whole: text, rest: "" } : { whole: text.slice(0, i), rest: text.slice(i) };
}
