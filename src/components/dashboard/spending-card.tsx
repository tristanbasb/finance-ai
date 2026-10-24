import Link from "next/link";
import { ChartPie } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClasses } from "@/components/ui/button";
import { CategoryDonut, type DonutSlice } from "@/components/charts/category-donut";

/** Dépenses du mois par catégorie (anneau + légende). */
export function SpendingCard({ slices, monthLabel }: { slices: DonutSlice[]; monthLabel: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Dépenses par catégorie</CardTitle>
        <CardDescription className="first-letter:uppercase">{monthLabel}</CardDescription>
      </CardHeader>
      <CardContent>
        {slices.length === 0 ? (
          <EmptyState
            icon={ChartPie}
            title="Aucune dépense ce mois-ci"
            description="Vos dépenses apparaîtront ici, réparties par catégorie."
            action={
              <Link href="/transactions" className={buttonClasses({ variant: "secondary", size: "sm" })}>
                Ajouter une transaction
              </Link>
            }
          />
        ) : (
          <CategoryDonut slices={slices} />
        )}
      </CardContent>
    </Card>
  );
}
