"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChartLine, Plus, RefreshCw } from "lucide-react";
import { Amount, splitEUR } from "@/components/amount";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/http";
import { AllocationChart, type AllocationSlice } from "./allocation-chart";
import { HoldingDialog, type HoldingAccountOption } from "./holding-dialog";
import { HoldingsTable } from "./holdings-table";
import { Pnl } from "./pnl";
import { ASSET_TYPE_LABELS, type AssetType, type HoldingGroup, type HoldingRow } from "./types";

export type InvestmentsViewProps = {
  /** Comptes actifs : seuls comptés dans les totaux et la répartition. */
  groups: HoldingGroup[];
  /** Comptes archivés ayant encore des positions : affichés en retrait, hors totaux. */
  archivedGroups?: HoldingGroup[];
  /** Comptes pouvant recevoir une position (investissement, crypto, autre). */
  accounts: HoldingAccountOption[];
};

type DialogState = { nonce: number; open: boolean; holding: HoldingRow | null };

const TYPE_COLORS: Record<AssetType, string> = {
  stock: "#3157d5",
  etf: "#0d9488",
  crypto: "#e59a1a",
  manual: "#8b5cf6",
};

/** Écran Investissements : synthèse, répartition, positions par compte et actualisation des cours. */
export function InvestmentsView({ groups, archivedGroups = [], accounts }: InvestmentsViewProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>({ nonce: 0, open: false, holding: null });
  const [refreshing, setRefreshing] = useState(false);

  const openAdd = () => setDialog((d) => ({ nonce: d.nonce + 1, open: true, holding: null }));
  const openEdit = (holding: HoldingRow) => setDialog((d) => ({ nonce: d.nonce + 1, open: true, holding }));
  const closeDialog = () => setDialog((d) => ({ ...d, open: false }));

  const { value, cost, count, hasMarket, slices } = useMemo(() => {
    let v = 0;
    let c = 0;
    let n = 0;
    let market = false;
    const byType = new Map<AssetType, number>();
    for (const g of groups) {
      for (const h of g.holdings) {
        v += h.value;
        c += h.cost;
        n += 1;
        if (h.assetType !== "manual") market = true;
        byType.set(h.assetType, (byType.get(h.assetType) ?? 0) + h.value);
      }
    }
    const s: AllocationSlice[] = [...byType].map(([type, total]) => ({
      key: type,
      name: ASSET_TYPE_LABELS[type],
      color: TYPE_COLORS[type],
      value: total,
    }));
    return { value: v, cost: c, count: n, hasMarket: market, slices: s };
  }, [groups]);

  const pnl = value - cost;
  const pnlPct = cost === 0 ? 0 : pnl / cost;
  const { whole, rest } = splitEUR(value);

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/prices/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      if (!res.ok) {
        toast.error("Actualisation impossible", { description: await errorMessage(res) });
        return;
      }
      const data = (await res.json()) as { updated: number; failed: string[] };
      if (data.updated > 0) toast.success(`${data.updated} cours mis à jour`);
      else if (data.failed.length === 0) toast("Aucun cours à actualiser");
      if (data.failed.length > 0) {
        toast.warning(`Cours indisponibles : ${data.failed.join(", ")} — dernier cours connu conservé`);
      }
      router.refresh();
    } catch {
      toast.error("Actualisation impossible", { description: "Le serveur est injoignable." });
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <p className="text-[13px] text-muted">
            {count === 0 ? "Aucune position" : `${count} ${count > 1 ? "positions" : "position"}`}
          </p>
          <h1 className="text-2xl font-semibold tracking-[-0.025em] text-fg sm:text-[28px]">Investissements</h1>
        </div>
        <div className="flex items-center gap-2">
          {hasMarket && (
            <Button variant="secondary" onClick={refresh} loading={refreshing}>
              {!refreshing && <RefreshCw aria-hidden />}
              Actualiser les cours
            </Button>
          )}
          <Button onClick={openAdd}>
            <Plus aria-hidden />
            Ajouter
          </Button>
        </div>
      </header>

      {count === 0 ? (
        <EmptyState
          icon={ChartLine}
          title="Aucune position pour l'instant"
          description={
            accounts.length === 0
              ? "Créez d'abord un compte de type Investissement ou Crypto dans les réglages, puis ajoutez vos positions."
              : "Ajoutez vos actions, ETF, cryptos ou autres actifs pour suivre leur valeur et leur performance."
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {accounts.length === 0 && (
                <Link href="/settings#comptes" className={buttonClasses({ variant: "secondary" })}>
                  Ouvrir les réglages
                </Link>
              )}
              <Button onClick={openAdd}>
                <Plus aria-hidden />
                Ajouter une position
              </Button>
            </div>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-5">
            <Card className="flex flex-col lg:col-span-3">
              <CardHeader>
                <CardDescription>Valeur totale</CardDescription>
                <p className="num pt-1 text-[40px] font-semibold leading-none tracking-[-0.035em] text-fg sm:text-5xl">
                  {whole}
                  <span className="text-[0.5em] text-subtle">{rest}</span>
                </p>
              </CardHeader>
              <div aria-hidden className="min-h-6 flex-1" />
              <div className="mx-5 grid grid-cols-2 gap-4 border-t border-border pb-5 pt-4 sm:mx-6 sm:pb-6">
                <div className="space-y-1">
                  <p className="text-[12px] font-medium text-muted sm:text-[13px]">Coût total</p>
                  <p className="num text-base font-semibold tracking-[-0.02em] text-fg sm:text-xl">
                    <Amount cents={cost} />
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-[12px] font-medium text-muted sm:text-[13px]">Plus ou moins-value</p>
                  <p className="text-base font-semibold tracking-[-0.02em] sm:text-xl">
                    <Pnl pnl={pnl} pct={pnlPct} className="flex-wrap gap-x-1.5" />
                  </p>
                </div>
              </div>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Répartition</CardTitle>
                <CardDescription>Par type d&apos;actif</CardDescription>
              </CardHeader>
              <CardContent>
                <AllocationChart slices={slices} />
              </CardContent>
            </Card>
          </div>

          <HoldingsTable groups={groups} onEdit={openEdit} />
        </>
      )}

      {archivedGroups.length > 0 && (
        <section aria-labelledby="comptes-archives" className="space-y-3">
          <div className="space-y-0.5">
            <h2 id="comptes-archives" className="text-[15px] font-semibold tracking-[-0.01em] text-muted">
              Comptes archivés
            </h2>
            <p className="text-[13px] text-subtle">Non comptés dans les totaux ni dans la répartition.</p>
          </div>
          <div className="opacity-60">
            <HoldingsTable groups={archivedGroups} onEdit={openEdit} />
          </div>
        </section>
      )}

      <HoldingDialog
        key={`holding-${dialog.nonce}`}
        open={dialog.open}
        onClose={closeDialog}
        accounts={accounts}
        holding={dialog.holding}
      />
    </div>
  );
}
