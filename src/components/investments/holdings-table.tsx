"use client";

import { Pencil } from "lucide-react";
import { Amount } from "@/components/amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
              <h3 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-fg">{g.account.name}</h3>
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
                <th scope="col" className="px-3 py-2.5 text-right font-medium">
                  Plus ou moins-value
                </th>
                <th scope="col" className="w-12 py-2.5 pr-4">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border border-t border-border">
              {g.holdings.map((h) => (
                <tr key={h.id} onClick={() => onEdit(h)} className="cursor-pointer transition-colors hover:bg-surface-2">
                  <td className="max-w-0 px-5 py-3">
                    <span className="block truncate font-medium text-fg">{h.name}</span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted">
                      <span className="truncate font-mono">{h.symbol}</span>
                      <Badge>{ASSET_TYPE_LABELS[h.assetType]}</Badge>
                    </span>
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
                  <td className="px-3 py-3 text-right">
                    <Pnl pnl={h.pnl} pct={h.pnlPct} stacked />
                  </td>
                  <td className="w-12 py-3 pr-4 text-right">
                    <EditButton name={h.name} onEdit={() => onEdit(h)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <ul className="divide-y divide-border border-t border-border md:hidden">
            {g.holdings.map((h) => (
              <li
                key={h.id}
                className="relative space-y-2 px-4 py-3.5 transition-colors hover:bg-surface-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">{h.name}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted">
                      <span className="truncate font-mono">{h.symbol}</span>
                      <Badge>{ASSET_TYPE_LABELS[h.assetType]}</Badge>
                    </p>
                  </div>
                  <Amount cents={h.value} className="shrink-0 pt-0.5 text-sm font-semibold text-fg" />
                  <EditButton name={h.name} onEdit={() => onEdit(h)} stretched />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 text-[12px]">
                  <p className="num flex flex-wrap items-center gap-1.5 text-muted">
                    {formatQuantity(h.quantity)} × {formatUnitPrice(h.price)}
                    <PriceSourceBadge source={h.source} />
                  </p>
                  <Pnl pnl={h.pnl} pct={h.pnlPct} className="text-[12px]" />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

/**
 * Bouton « Modifier » dédié : le nom accessible ne remplace aucune donnée affichée.
 * `stretched` étend sa zone de toucher à toute la carte parent (qui doit être `relative`).
 */
function EditButton({ name, onEdit, stretched = false }: { name: string; onEdit: () => void; stretched?: boolean }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={stretched ? "-mr-2 -mt-1.5 size-8 after:absolute after:inset-0" : "size-8"}
      onClick={(e) => {
        e.stopPropagation();
        onEdit();
      }}
      aria-label={`Modifier ${name}`}
    >
      <Pencil aria-hidden />
    </Button>
  );
}
