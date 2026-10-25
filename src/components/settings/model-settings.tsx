"use client";

import { ModelSelect } from "@/components/assistant/model-select";

/** Choix du modèle Claude, partagé par le chat, les alertes et les bilans. */
export function ModelSettings() {
  return (
    <div className="space-y-1.5">
      <ModelSelect size="field" label="Modèle" className="max-w-sm" />
      <p className="text-[13px] text-muted">Modèle utilisé pour le chat, les alertes et les bilans.</p>
    </div>
  );
}
