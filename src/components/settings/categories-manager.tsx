"use client";

import { useState } from "react";
import { Pencil, Plus, Tags } from "lucide-react";
import { CategoryIcon } from "@/components/category-icon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatEUR } from "@/lib/money";
import { CategoryDialog } from "./category-dialog";
import type { CategoryKind, CategoryRow } from "./types";

type DialogState = { nonce: number; open: boolean; category: CategoryRow | null; kind: CategoryKind };

/** Section « Catégories » des réglages : dépenses et revenus, couleur, icône et budget mensuel. */
export function CategoriesManager({ categories }: { categories: CategoryRow[] }) {
  const [dialog, setDialog] = useState<DialogState>({ nonce: 0, open: false, category: null, kind: "expense" });
  const openAdd = (kind: CategoryKind) => setDialog((d) => ({ nonce: d.nonce + 1, open: true, category: null, kind }));
  const openEdit = (category: CategoryRow) =>
    setDialog((d) => ({ nonce: d.nonce + 1, open: true, category, kind: category.kind }));
  const closeDialog = () => setDialog((d) => ({ ...d, open: false }));

  const expenses = categories.filter((c) => c.kind === "expense");
  const incomes = categories.filter((c) => c.kind === "income");

  return (
    <Card id="categories" className="scroll-mt-6">
      <CardHeader
        action={
          <Button size="sm" onClick={() => openAdd("expense")}>
            <Plus aria-hidden />
            Ajouter
          </Button>
        }
      >
        <CardTitle>Catégories</CardTitle>
        <CardDescription>
          Classez vos transactions et fixez un budget mensuel par catégorie de dépenses.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {categories.length === 0 ? (
          <EmptyState
            icon={Tags}
            title="Aucune catégorie"
            description="Créez des catégories pour classer vos dépenses et vos revenus."
            action={
              <Button onClick={() => openAdd("expense")}>
                <Plus aria-hidden />
                Ajouter une catégorie
              </Button>
            }
          />
        ) : (
          <>
            <Group
              title="Dépenses"
              categories={expenses}
              emptyText="Aucune catégorie de dépenses."
              onAdd={() => openAdd("expense")}
              onEdit={openEdit}
            />
            <Group
              title="Revenus"
              categories={incomes}
              emptyText="Aucune catégorie de revenus."
              onAdd={() => openAdd("income")}
              onEdit={openEdit}
            />
          </>
        )}
      </CardContent>

      <CategoryDialog
        key={`category-${dialog.nonce}`}
        open={dialog.open}
        onClose={closeDialog}
        category={dialog.category}
        defaultKind={dialog.kind}
      />
    </Card>
  );
}

function Group({
  title,
  categories,
  emptyText,
  onAdd,
  onEdit,
}: {
  title: string;
  categories: CategoryRow[];
  emptyText: string;
  onAdd: () => void;
  onEdit: (c: CategoryRow) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[12px] font-medium uppercase tracking-wide text-subtle">
          {title} ({categories.length})
        </h3>
        <Button variant="ghost" size="sm" className="-mr-2" onClick={onAdd} aria-label={`Ajouter une catégorie de ${title.toLowerCase()}`}>
          <Plus aria-hidden />
          Ajouter
        </Button>
      </div>
      {categories.length === 0 ? (
        <p className="text-[13px] text-muted">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-border">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <CategoryIcon icon={c.icon} color={c.color} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg">{c.name}</p>
                {c.kind === "expense" && (
                  <p className="num text-[12px] text-muted">
                    {c.monthlyBudget != null ? `Budget : ${formatEUR(c.monthlyBudget)} / mois` : "Sans budget"}
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="-mr-2"
                onClick={() => onEdit(c)}
                aria-label={`Modifier la catégorie ${c.name}`}
              >
                <Pencil aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
