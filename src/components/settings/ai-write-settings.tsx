"use client";

import { useEffect, useRef, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/http";

const ENDPOINT = "/api/settings/ai-write";

/**
 * « Autoriser Claude à modifier mes données » (activé par défaut). Enregistrement optimiste :
 * l'interrupteur bascule tout de suite, puis revient en arrière si le serveur refuse.
 */
export function AiWriteSettings() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(ENDPOINT, { signal: controller.signal, cache: "no-store" });
        if (!res.ok) throw new Error();
        const body = (await res.json()) as { enabled?: unknown };
        if (!controller.signal.aborted) setEnabled(body.enabled !== false);
      } catch {
        // Lecture impossible : valeur par défaut affichée, l'enregistrement dira si le serveur répond.
        if (!controller.signal.aborted) setEnabled(true);
      }
    })();
    return () => controller.abort();
  }, []);

  async function change(next: boolean) {
    const previous = enabled;
    const id = ++seq.current;
    setEnabled(next);
    try {
      const res = await fetch(ENDPOINT, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      const body = (await res.json()) as { enabled?: unknown };
      if (id !== seq.current) return;
      const saved = body.enabled === true;
      setEnabled(saved);
      toast.success(saved ? "Claude peut modifier vos données" : "Claude ne modifie plus vos données", {
        description: saved ? "Uniquement à votre demande, annulable pendant 24 h." : "Il reste disponible en lecture seule.",
      });
    } catch (err) {
      if (id === seq.current) setEnabled(previous);
      toast.error("Réglage non enregistré", {
        description: err instanceof Error && err.message ? err.message : "Le serveur ne répond pas. Réessayez.",
      });
    }
  }

  if (enabled === null) {
    return <div className="h-12 animate-pulse rounded-xl bg-surface-2" aria-label="Chargement du réglage" aria-busy="true" />;
  }

  return (
    <Switch
      label="Autoriser Claude à modifier mes données"
      description="Claude ne modifie vos données qu'à votre demande explicite. Chaque modification peut être annulée pendant 24 h. Les alertes et les bilans ne modifient jamais rien."
      checked={enabled}
      onChange={(v) => void change(v)}
    />
  );
}
