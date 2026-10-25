"use client";

import { useEffect, useReducer, useRef } from "react";
import { CircleAlert, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { writeToggleReducer } from "@/lib/ai-actions-ui";
import { errorMessage } from "@/lib/http";

const ENDPOINT = "/api/settings/ai-write";

/**
 * « Autoriser Claude à modifier mes données » (activé par défaut). Enregistrement optimiste, une
 * bascule à la fois (les clics pendant l'enregistrement sont ignorés) ; en cas d'échec,
 * l'interrupteur revient à la dernière valeur confirmée par le serveur.
 */
export function AiWriteSettings() {
  const [state, dispatch] = useReducer(writeToggleReducer, { status: "loading" });
  const savingRef = useRef(false);

  useEffect(() => {
    if (state.status !== "loading") return;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(ENDPOINT, { signal: controller.signal, cache: "no-store" });
        if (!res.ok) throw new Error();
        const body = (await res.json()) as { enabled?: unknown };
        if (typeof body.enabled !== "boolean") throw new Error();
        if (!controller.signal.aborted) dispatch({ type: "loaded", enabled: body.enabled });
      } catch {
        if (!controller.signal.aborted) dispatch({ type: "loadFailed" });
      }
    })();
    return () => controller.abort();
  }, [state.status]);

  async function change(next: boolean) {
    if (state.status !== "ready" || savingRef.current) return;
    savingRef.current = true;
    dispatch({ type: "toggle", next });
    try {
      const res = await fetch(ENDPOINT, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      const body = (await res.json()) as { enabled?: unknown };
      if (typeof body.enabled !== "boolean") throw new Error("Réponse inattendue du serveur.");
      dispatch({ type: "saved", enabled: body.enabled });
      toast.success(body.enabled ? "Claude peut modifier vos données" : "Claude ne modifie plus vos données", {
        description: body.enabled
          ? "Uniquement à votre demande, annulable pendant 24 h."
          : "Il reste disponible en lecture seule.",
      });
    } catch (err) {
      dispatch({ type: "saveFailed" });
      toast.error("Réglage non enregistré", {
        description: err instanceof Error && err.message ? err.message : "Le serveur ne répond pas. Réessayez.",
      });
    } finally {
      savingRef.current = false;
    }
  }

  if (state.status === "loading") {
    return <div className="h-12 animate-pulse rounded-xl bg-surface-2" aria-label="Chargement du réglage" aria-busy="true" />;
  }

  if (state.status === "error") {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted">
        <CircleAlert aria-hidden className="size-4 shrink-0 text-danger" />
        <span className="min-w-0 flex-1">Impossible de lire le réglage « Autoriser Claude à modifier mes données ».</span>
        <Button variant="secondary" size="sm" onClick={() => dispatch({ type: "retry" })}>
          <RotateCcw aria-hidden />
          Réessayer
        </Button>
      </div>
    );
  }

  return (
    <div aria-busy={state.saving || undefined}>
      <Switch
        label="Autoriser Claude à modifier mes données"
        description="Claude ne modifie vos données qu'à votre demande explicite. Chaque modification peut être annulée pendant 24 h. Les alertes et les bilans ne modifient jamais rien."
        checked={state.shown}
        onChange={(v) => void change(v)}
      />
    </div>
  );
}
