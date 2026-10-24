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
  account: { id: number; name: string; color: string; archived: boolean };
  holdings: HoldingRow[];
  value: number;
  cost: number;
  pnl: number;
};

/**
 * Positions regroupées par compte (ordre des comptes conservé, comptes sans position omis).
 * Les comptes archivés sont à part : affichés en retrait, jamais comptés dans les totaux.
 */
export function buildHoldingGroups(
  accounts: HoldingGroup["account"][],
  rows: HoldingRow[],
): { active: HoldingGroup[]; archived: HoldingGroup[] } {
  const groups = accounts
    .map((account) => {
      const holdings = rows.filter((r) => r.accountId === account.id);
      return {
        account,
        holdings,
        value: holdings.reduce((sum, h) => sum + h.value, 0),
        cost: holdings.reduce((sum, h) => sum + h.cost, 0),
        pnl: holdings.reduce((sum, h) => sum + h.pnl, 0),
      };
    })
    .filter((g) => g.holdings.length > 0);
  return {
    active: groups.filter((g) => !g.account.archived),
    archived: groups.filter((g) => g.account.archived),
  };
}

const quantityFormatter = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 8 });

/** Quantité à la française, jusqu'à 8 décimales (crypto). */
export function formatQuantity(quantity: number): string {
  return quantityFormatter.format(quantity);
}
