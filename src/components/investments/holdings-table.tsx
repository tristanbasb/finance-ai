"use client";

import { Amount } from "@/components/amount";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatUnitPrice } from "@/lib/money";
import { Pnl, PriceSourceBadge } from "./pnl";
import { ASSET_TYPE_LABELS, formatQuantity, type HoldingGroup, type HoldingRow } from "./types";

export type HoldingsTableProps = {
  groups: HoldingGroup[];
  onEdit: (holding: HoldingRow) => void;
};

/**
 * Positions regroupées par compte. Tableau dès `md`, cartes empilées en dessous
 * (jamais de défilement horizontal de la page).
 */
export function HoldingsTable({ groups, onEdit }: HoldingsTableProps) {
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <Card key={g.account.id} className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
            <div className="flex min-w-0 items-center gap-2.5">
              <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: g.account.color }} />
              <h2 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-fg">{g.account.name}</h2>
              <span className="shrink-0 text-[13px] text-muted">
                {g.holdings.length} {g.holdings.length > 1 ? "positions" : "position"}
              </span>
            </div>
            <Amount cents={g.value} className="shrink-0 text-sm font-semibold text-fg" />
          </div>

          <table className="hidden w-full border-t border-border text-sm md:table">
            <caption className="sr-only">Positions du compte {g.account.name}</caption>
            <thead>
              <tr className="text-[12px] font-medium text-muted">
                <th scope="col" className="w-[36%] px-5 py-2.5 text-left font-medium">
                  Position
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">
                  Quantité
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">
                  Cours
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">
                  Valeur
                </th>
                <th scope="col" className="px-5 py-2.5 text-right font-medium">
                  Plus ou moins-value
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border border-t border-border">
              {g.holdings.map((h) => (
                <tr key={h.id} onClick={() => onEdit(h)} className="cursor-pointer transition-colors hover:bg-surface-2">
                  <td className="max-w-0 px-5 py-3">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit(h);
                      }}
                      aria-label={`Modifier ${h.name}`}
                      className="block max-w-full rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      <span className="block truncate font-medium text-fg">{h.name}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted">
                        <span className="truncate font-mono">{h.symbol}</span>
                        <Badge>{ASSET_TYPE_LABELS[h.assetType]}</Badge>
                      </span>
                    </button>
                  </td>
                  <td className="num px-3 py-3 text-right text-fg">{formatQuantity(h.quantity)}</td>
                  <td className="px-3 py-3 text-right">
                    <span className="num block text-fg">{formatUnitPrice(h.price)}</span>
                    <span className="mt-0.5 inline-block">
                      <PriceSourceBadge source={h.source} />
                    </span>
                  </td>
                  <td className="num px-3 py-3 text-right font-medium text-fg">
                    <Amount cents={h.value} />
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Pnl pnl={h.pnl} pct={h.pnlPct} stacked />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <ul className="divide-y divide-border border-t border-border md:hidden">
            {g.holdings.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  onClick={() => onEdit(h)}
                  aria-label={`Modifier ${h.name}`}
                  className="block w-full space-y-2 px-4 py-3.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-fg">{h.name}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted">
                        <span className="truncate font-mono">{h.symbol}</span>
                        <Badge>{ASSET_TYPE_LABELS[h.assetType]}</Badge>
                      </span>
                    </span>
                    <Amount cents={h.value} className="shrink-0 text-sm font-semibold text-fg" />
                  </span>
                  <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 text-[12px]">
                    <span className="num flex flex-wrap items-center gap-1.5 text-muted">
                      {formatQuantity(h.quantity)} × {formatUnitPrice(h.price)}
                      <PriceSourceBadge source={h.source} />
                    </span>
                    <Pnl pnl={h.pnl} pct={h.pnlPct} className="text-[12px]" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
