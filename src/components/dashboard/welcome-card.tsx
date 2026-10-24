import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";

/** Premier lancement (aucune transaction) : une seule action pour démarrer. */
export function WelcomeCard() {
  return (
    // Pas de <Card> : `cn` ne résout pas les conflits de classes (bg-surface l'emporterait).
    <section className="flex flex-col gap-4 rounded-2xl border border-accent/20 bg-accent-soft p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
      <div className="space-y-1">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-fg">Bienvenue sur Finance AI</h2>
        <p className="max-w-xl text-[13px] text-muted">
          Ajoutez vos premières transactions ou importez un relevé bancaire (CSV) : le tableau de
          bord se remplit automatiquement.
        </p>
      </div>
      <Link href="/transactions" className={buttonClasses({ className: "self-start sm:self-auto" })}>
        Ajouter des transactions
        <ArrowRight aria-hidden />
      </Link>
    </section>
  );
}
