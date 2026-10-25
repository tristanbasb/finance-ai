// Logique pure de l'accueil : variation du patrimoine et mini-courbe de la carte héros.
import { formatDateShort, NARROW_NBSP } from "@/lib/format";
import { formatEUR } from "@/lib/money";

export type NetWorthPoint = { date: string; netWorth: number };

export type NetWorthVariation = {
  /** Écart entre le dernier et le premier instantané (centimes). */
  change: number;
  /** Date du premier instantané de la période (YYYY-MM-DD). */
  since: string;
};

/** Variation du patrimoine sur la période des instantanés (par date croissante) ; `null` sous 2 points. */
export function netWorthVariation(points: readonly NetWorthPoint[]): NetWorthVariation | null {
  if (points.length < 2) return null;
  return {
    change: points[points.length - 1].netWorth - points[0].netWorth,
    since: points[0].date,
  };
}

/** Montant signé de la variation : « +1 836,00 € », « −250,00 € », « 0,00 € ». */
export function variationAmount(change: number): string {
  const sign = change > 0 ? "+" : change < 0 ? "−" : "";
  return `${sign}${sign && NARROW_NBSP}${formatEUR(Math.abs(change))}`;
}

/** Phrase complète : « +1 836,00 € depuis le 27 juil. » (« Stable depuis le … » sans écart). */
export function variationLabel({ change, since }: NetWorthVariation): string {
  const from = `depuis le ${formatDateShort(since)}`;
  return change === 0 ? `Stable ${from}` : `${variationAmount(change)} ${from}`;
}

export type Sparkline = {
  /** Tracé de la ligne (`d` d'un <path>), dans un repère `width` × `height`. */
  line: string;
  /** Même tracé fermé jusqu'au bas du repère, pour un lavis sous la courbe. */
  area: string;
  /** Dernier point, pour le repère de fin de courbe. */
  last: { x: number; y: number };
};

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Mini-courbe sans axes : les valeurs sont réparties sur toute la largeur et mises à l'échelle
 * entre `pad` et `height - pad` (le minimum en bas). Une série constante est tracée au milieu.
 * `null` sous 2 valeurs.
 */
export function sparkline(values: readonly number[], width: number, height: number, pad = 2): Sparkline | null {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const step = width / (values.length - 1);
  const pts = values.map((v, i) => ({
    x: round(i * step),
    y: round(span === 0 ? height / 2 : pad + (1 - (v - min) / span) * (height - 2 * pad)),
  }));
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
  return {
    line,
    area: `${line} L${round(width)} ${height} L0 ${height} Z`,
    last: pts[pts.length - 1],
  };
}
