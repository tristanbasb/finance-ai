import { ArrowDownRight, ArrowUpRight, ChartSpline, Minus } from "lucide-react";
import { splitEUR } from "@/components/amount";
import { netWorthVariation, sparkline, variationLabel, type NetWorthPoint } from "@/lib/home";
import { cn } from "@/lib/cn";
import { formatEUR } from "@/lib/money";
import { HeroHalos } from "@/components/ui/hero-halos";

const W = 320;
const H = 64;

export type HomeHeroProps = {
  netWorth: number;
  cash: number;
  investments: number;
  /** Instantanés par date croissante. */
  points: NetWorthPoint[];
  className?: string;
};

/** Carte héros de l'accueil : patrimoine net, variation sur la période, mini-courbe blanche. */
export function HomeHero({ netWorth, cash, investments, points, className }: HomeHeroProps) {
  const { whole, rest } = splitEUR(netWorth);
  const variation = netWorthVariation(points);
  const curve = sparkline(
    points.map((p) => p.netWorth),
    W,
    H,
    4,
  );
  const Icon = !variation || variation.change === 0 ? Minus : variation.change > 0 ? ArrowUpRight : ArrowDownRight;

  return (
    <section
      aria-labelledby="home-hero-title"
      className={cn(
        "relative flex flex-col overflow-hidden rounded-hero bg-brand-gradient p-6 text-white shadow-glow sm:p-7",
        className,
      )}
    >
      <HeroHalos second="left" />

      <div className="relative space-y-2">
        <h2 id="home-hero-title" className="text-[13px] font-semibold text-white">
          Patrimoine net
        </h2>
        <p className="num text-[40px] font-bold leading-none tracking-[-0.035em] text-white sm:text-[52px]">
          {whole}
          <span className="text-[0.5em] font-semibold tracking-[-0.01em] text-white">{rest}</span>
        </p>
        <p className="num pt-1 text-[13px] font-semibold text-white">
          {variation ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-black/20 px-2.5 py-1">
              <Icon aria-hidden className="size-3.5" />
              {variationLabel(variation)}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/20 px-2.5 py-1">
              <ChartSpline aria-hidden className="size-3.5" />
              Votre courbe se dessine au fil des jours
            </span>
          )}
        </p>
      </div>

      {curve && (
        <div className="relative mt-5 h-16 w-full">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            aria-hidden
            className="absolute inset-0 size-full overflow-visible"
          >
            <path d={curve.area} fill="white" fillOpacity={0.12} />
            <path
              d={curve.line}
              fill="none"
              stroke="white"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {/* Repère de fin hors du SVG étiré, pour rester rond. */}
          <span
            aria-hidden
            className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white ring-4 ring-white/25"
            style={{
              left: `${(curve.last.x / W) * 100}%`,
              top: `${(curve.last.y / H) * 100}%`,
            }}
          />
        </div>
      )}

      <dl className="relative mt-auto flex flex-wrap gap-2 pt-5 text-[13px]">
        {[
          { label: "Liquidités", value: cash },
          { label: "Investissements", value: investments },
        ].map((l) => (
          <div key={l.label} className="inline-flex items-baseline gap-2 rounded-full bg-black/15 px-3.5 py-1.5">
            <dt className="font-medium text-white">{l.label}</dt>
            <dd className="num font-semibold text-white">{formatEUR(l.value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
