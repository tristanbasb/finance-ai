"use client";

import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/button";
import { useQuickAdd } from "./quick-add-provider";

/** Bouton qui ouvre la saisie rapide (utilisable depuis un composant serveur, ex. état vide). */
export function QuickAddButton({
  variant = "primary",
  size = "md",
  className,
  children = "Ajouter une opération",
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children?: ReactNode;
}) {
  const { open } = useQuickAdd();
  return (
    <Button variant={variant} size={size} className={className} onClick={() => open()}>
      <Plus aria-hidden />
      {children}
    </Button>
  );
}
