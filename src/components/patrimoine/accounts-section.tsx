import Link from "next/link";
import { Landmark, Plus } from "lucide-react";
import { Amount } from "@/components/amount";
import { categoryIconComponent } from "@/components/category-icon";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { tintStyle } from "@/lib/category-tint";
import { ACCOUNT_TYPE_LABELS } from "@/components/settings/types";

export type PatrimoineAccount = {
  id: number;
  name: string;
  type: keyof typeof ACCOUNT_TYPE_LABELS;
  color: string;
  /** Solde + valeur des positions (centimes). */
  total: number;
};

const TYPE_ICONS: Record<PatrimoineAccount["type"], string> = {
  checking: "wallet",
  savings: "piggy-bank",
  investment: "trending-up",
  crypto: "coins",
  other: "tag",
};

const GROUPS: { title: string; types: PatrimoineAccount["type"][] }[] = [
  { title: "Courant", types: ["checking"] },
  { title: "Épargne", types: ["savings"] },
  { title: "Investissement, crypto et autres", types: ["investment", "crypto", "other"] },
];

/** Section « Comptes » : cartes pastel groupées par nature de compte. */
export function AccountsSection({ accounts }: { accounts: PatrimoineAccount[] }) {
  return (
    <section id="comptes" aria-labelledby="patrimoine-comptes" className="scroll-mt-32 space-y-4">
      {/* Alias d'ancre : l'ancienne rubrique Épargne. */}
      <span id="epargne" aria-hidden className="scroll-mt-32" />
      <div className="flex items-center justify-between gap-3">
        <h2 id="patrimoine-comptes" className="px-1 text-xl font-semibold tracking-[-0.02em] text-fg">
          Comptes
        </h2>
        <Link href="/settings#comptes" className={buttonClasses({ variant: "secondary", size: "sm" })}>
          <Plus aria-hidden />
          Gérer les comptes
        </Link>
      </div>

      {accounts.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title="Aucun compte pour l'instant"
          description="Ajoutez votre compte courant, vos livrets et vos placements pour suivre votre patrimoine."
          action={
            <Link href="/settings#comptes" className={buttonClasses()}>
              <Plus aria-hidden />
              Créer un compte
            </Link>
          }
        />
      ) : (
        <div className="space-y-5">
          {GROUPS.map((group) => {
            const list = accounts.filter((a) => group.types.includes(a.type));
            if (list.length === 0) return null;
            return (
              <div key={group.title} className="space-y-2.5">
                <h3 className="px-1 text-[13px] font-semibold text-muted">{group.title}</h3>
                <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {list.map((a) => {
                    const Icon = categoryIconComponent(TYPE_ICONS[a.type]);
                    return (
                    <li key={a.id}>
                      <div
                        style={tintStyle(a.color)}
                        className="tint flex h-full flex-col gap-4 rounded-card border border-(--tint-ring) p-4 sm:p-5"
                      >
                        <div className="flex items-center gap-3">
                          <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-surface/70">
                            <Icon className="size-5" strokeWidth={2} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold">{a.name}</p>
                            <p className="text-[12px] font-medium">{ACCOUNT_TYPE_LABELS[a.type]}</p>
                          </div>
                        </div>
                        <Amount cents={a.total} className="text-2xl font-semibold tracking-[-0.025em]" />
                      </div>
                    </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
