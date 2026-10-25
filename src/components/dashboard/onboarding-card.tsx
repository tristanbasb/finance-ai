"use client";

import Link from "next/link";
import { Landmark, Plus, Upload } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/button";
import { useQuickAdd } from "@/components/quick-add/quick-add-provider";
import { cn } from "@/lib/cn";

/**
 * Premier lancement (aucune opération) : trois façons de démarrer. Sans compte, la création d'un
 * compte passe en premier (une opération en a besoin).
 */
export function OnboardingCard({ hasAccounts, className }: { hasAccounts: boolean; className?: string }) {
  const { open, openImport } = useQuickAdd();

  const add = (
    <Button key="add" variant={hasAccounts ? "primary" : "secondary"} onClick={() => open()}>
      <Plus aria-hidden />
      Ajouter une opération
    </Button>
  );
  const importStatement = (
    <Button key="import" variant="secondary" onClick={openImport}>
      <Upload aria-hidden />
      Importer un relevé
    </Button>
  );
  const account = (
    <Link
      key="account"
      href="/settings#comptes"
      className={buttonClasses({
        variant: hasAccounts ? "secondary" : "primary",
      })}
    >
      <Landmark aria-hidden />
      Créer un compte
    </Link>
  );

  return (
    <section
      aria-labelledby="home-onboarding-title"
      className={cn("rounded-hero border border-brand/15 bg-brand-soft p-5 sm:p-6", className)}
    >
      <h2 id="home-onboarding-title" className="text-[17px] font-bold tracking-[-0.02em] text-fg">
        Bienvenue sur Finance AI
      </h2>
      <p className="mt-1 max-w-xl text-[14px] text-muted">
        {hasAccounts
          ? "Ajoutez votre première opération ou importez le relevé CSV de votre banque : l'accueil se remplira tout seul."
          : "Créez d'abord le compte sur lequel vous suivez votre argent, puis ajoutez vos opérations ou importez un relevé CSV."}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {hasAccounts ? [add, importStatement, account] : [account, add, importStatement]}
      </div>
    </section>
  );
}
