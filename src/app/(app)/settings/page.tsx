import type { Metadata } from "next";
import { Database, Download, KeyRound } from "lucide-react";
import { getDb } from "@/lib/db";
import { listAccountsWithBalances } from "@/lib/queries/accounts";
import { listCategories } from "@/lib/queries/categories";
import { AccountsManager } from "@/components/settings/accounts-manager";
import { AiStatus } from "@/components/settings/ai-status";
import { CategoriesManager } from "@/components/settings/categories-manager";
import { NotificationsSettings } from "@/components/settings/notifications-settings";
import { SettingsNav } from "@/components/settings/settings-nav";
import { TelegramSettings } from "@/components/settings/telegram-settings";
import { LogoutButton } from "@/components/logout-button";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Réglages" };

const codeClasses = "rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12px] text-fg";

export default function SettingsPage() {
  const db = getDb();
  const accounts = listAccountsWithBalances(db).map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    initialBalance: a.initialBalance,
    color: a.color,
    archived: a.archived,
    balance: a.balance,
  }));
  const categories = listCategories(db).map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    color: c.color,
    icon: c.icon,
    monthlyBudget: c.monthlyBudget,
  }));

  return (
    <div className="space-y-5 sm:space-y-6">
      <header className="space-y-1">
        <p className="text-[13px] text-muted">Comptes, catégories et configuration</p>
        <h1 className="text-2xl font-semibold tracking-[-0.025em] text-fg sm:text-[28px]">Réglages</h1>
      </header>

      <SettingsNav />

      <AccountsManager accounts={accounts} />
      <CategoriesManager categories={categories} />
      <AiStatus />
      <NotificationsSettings />
      <TelegramSettings />

      <Card id="donnees" className="scroll-mt-32">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database aria-hidden className="size-4 text-muted" />
            Données
          </CardTitle>
          <CardDescription>Vos données restent sur votre serveur. Exportez-les quand vous le souhaitez.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <a href="/api/export" download className={buttonClasses({ variant: "secondary" })}>
            <Download aria-hidden />
            Exporter mes données (JSON)
          </a>
          <p className="text-[13px] leading-relaxed text-muted">
            L&apos;export contient toutes vos données : comptes, catégories, transactions, objectifs, positions et historique. Une sauvegarde complète
            de <code className={codeClasses}>data/finance.db</code> est réalisée à chaque mise à jour par{" "}
            <code className={codeClasses}>update.sh</code>.
          </p>
        </CardContent>
      </Card>

      <Card id="securite" className="scroll-mt-32">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound aria-hidden className="size-4 text-muted" />
            Sécurité
          </CardTitle>
          <CardDescription>L&apos;accès à l&apos;application est protégé par un mot de passe unique.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-[13px] leading-relaxed text-muted">
            Pour changer le mot de passe, exécutez <code className={codeClasses}>./scripts/set-password.sh</code> sur
            le serveur, puis reconnectez-vous.
          </p>
          <LogoutButton appearance="button" />
        </CardContent>
      </Card>
    </div>
  );
}
