// Types et libellés partagés par les composants de la page Investissements (sérialisables).

export type AssetType = "stock" | "etf" | "crypto" | "manual";

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  stock: "Action",
  etf: "ETF",
  crypto: "Crypto",
  manual: "Manuel",
};

/** Origine du prix unitaire affiché. */
export type PriceSource = "live" | "cache" | "manual" | "cost";

export type HoldingRow = {
  id: number;
  accountId: number;
  symbol: string;
  name: string;
  assetType: AssetType;
  quantity: number;
  /** Prix de revient unitaire, en centimes réels. */
  avgPrice: number;
  manualPrice: number | null;
  currency: string;
  /** Prix unitaire retenu, en centimes réels, et son origine. */
  price: number;
  source: PriceSource;
  /** Valeur, coût et plus-value en centimes entiers ; `pnlPct` en fraction. */
  value: number;
  cost: number;
  pnl: number;
  pnlPct: number;
};

export type HoldingGroup = {
  account: { id: number; name: string; color: string };
  holdings: HoldingRow[];
  value: number;
  cost: number;
  pnl: number;
};

const quantityFormatter = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 8 });

/** Quantité à la française, jusqu'à 8 décimales (crypto). */
export function formatQuantity(quantity: number): string {
  return quantityFormatter.format(quantity);
}
