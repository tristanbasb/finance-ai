"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArchiveRestore, Landmark, Pencil, Plus } from "lucide-react";
import { Amount } from "@/components/amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/http";
import { AccountDialog } from "./account-dialog";
import { ACCOUNT_TYPE_LABELS, type AccountRow } from "./types";

type DialogState = { nonce: number; open: boolean; account: AccountRow | null };

/** Section « Comptes » des réglages : liste (archivés à part) et dialogue d'ajout / modification. */
export function AccountsManager({ accounts }: { accounts: AccountRow[] }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>({ nonce: 0, open: false, account: null });
  const [restoring, setRestoring] = useState<number | null>(null);

  const openAdd = () => setDialog((d) => ({ nonce: d.nonce + 1, open: true, account: null }));
  const openEdit = (account: AccountRow) => setDialog((d) => ({ nonce: d.nonce + 1, open: true, account }));
  const closeDialog = () => setDialog((d) => ({ ...d, open: false }));

  const active = accounts.filter((a) => !a.archived);
  const archived = accounts.filter((a) => a.archived);

  async function restore(account: AccountRow) {
    setRestoring(account.id);
    try {
      const res = await fetch(`/api/accounts/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: false }),
      });
      if (!res.ok) {
        toast.error("Réactivation impossible", { description: await errorMessage(res) });
        return;
      }
      toast.success("Compte réactivé", { description: account.name });
      router.refresh();
    } catch {
      toast.error("Réactivation impossible", { description: "Le serveur est injoignable." });
    } finally {
      setRestoring(null);
    }
  }

  return (
    <Card id="comptes" className="scroll-mt-section">
      <CardHeader
        action={
          <Button size="sm" onClick={openAdd}>
            <Plus aria-hidden />
            Ajouter
          </Button>
        }
      >
        <CardTitle className="flex items-center gap-2">
          <Landmark aria-hidden className="size-4 text-muted" />
          Comptes
        </CardTitle>
        <CardDescription>Vos comptes courants, livrets et portefeuilles d&apos;investissement.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {accounts.length === 0 ? (
          <EmptyState
            icon={Landmark}
            title="Aucun compte"
            description="Ajoutez un premier compte pour saisir vos transactions."
            action={
              <Button onClick={openAdd}>
                <Plus aria-hidden />
                Ajouter un compte
              </Button>
            }
          />
        ) : (
          <>
            {active.length === 0 ? (
              <p className="text-[13px] text-muted">Tous vos comptes sont archivés.</p>
            ) : (
              <ul className="divide-y divide-border">
                {active.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <AccountIdentity account={a} />
                    <Amount cents={a.balance} className="shrink-0 text-sm font-semibold text-fg" />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="-mr-2"
                      onClick={() => openEdit(a)}
                      aria-label={`Modifier le compte ${a.name}`}
                    >
                      <Pencil aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            {archived.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-[12px] font-medium uppercase tracking-wide text-subtle">
                  Archivés ({archived.length})
                </h3>
                <ul className="divide-y divide-border opacity-80">
                  {archived.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                      <AccountIdentity account={a} dimmed />
                      <Amount cents={a.balance} className="hidden shrink-0 text-sm text-muted sm:inline" />
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => restore(a)}
                        loading={restoring === a.id}
                        aria-label={`Réactiver le compte ${a.name}`}
                      >
                        <ArchiveRestore aria-hidden />
                        Réactiver
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="-mr-2"
                        onClick={() => openEdit(a)}
                        aria-label={`Modifier le compte ${a.name}`}
                      >
                        <Pencil aria-hidden />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>

      <AccountDialog key={`account-${dialog.nonce}`} open={dialog.open} onClose={closeDialog} account={dialog.account} />
    </Card>
  );
}

function AccountIdentity({ account, dimmed = false }: { account: AccountRow; dimmed?: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: account.color, opacity: dimmed ? 0.55 : 1 }}
      />
      <div className="min-w-0">
        <p className={dimmed ? "truncate text-sm text-muted" : "truncate text-sm font-medium text-fg"}>{account.name}</p>
        <p className="flex items-center gap-1.5 text-[12px] text-muted">
          <Badge>{ACCOUNT_TYPE_LABELS[account.type]}</Badge>
        </p>
      </div>
    </div>
  );
}
