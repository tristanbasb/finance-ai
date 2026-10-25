"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { ModelSettings } from "@/components/settings/model-settings";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type State = { kind: "loading" } | { kind: "disabled" } | { kind: "enabled" };

/**
 * Section « Assistant IA ». Toute réponse non OK de /api/ai/status vaut « Non configuré ».
 * Seul l'état (activé, modèle) est lu : la clé API n'est jamais demandée ni affichée.
 */
export function AiStatus() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/ai/status", { signal: controller.signal, cache: "no-store" });
        if (!res.ok) throw new Error();
        const body = (await res.json()) as { enabled?: unknown };
        if (controller.signal.aborted) return;
        setState(
          body.enabled === true ? { kind: "enabled" } : { kind: "disabled" },
        );
      } catch {
        if (!controller.signal.aborted) setState({ kind: "disabled" });
      }
    })();
    return () => controller.abort();
  }, []);

  return (
    <Card id="ia" className="scroll-mt-section">
      <CardHeader
        action={
          state.kind === "enabled" ? (
            <Badge variant="positive">Activé</Badge>
          ) : state.kind === "disabled" ? (
            <Badge>Non configuré</Badge>
          ) : null
        }
      >
        <CardTitle className="flex items-center gap-2">
          <Sparkles aria-hidden className="size-4 text-accent" />
          Assistant IA
        </CardTitle>
        <CardDescription>Analyses de vos dépenses et suggestions de catégories, propulsées par Claude.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ModelSettings />
        <div aria-live="polite" aria-busy={state.kind === "loading"}>
        {state.kind === "loading" && (
          <div className="h-4 w-48 animate-pulse rounded-full bg-surface-2" aria-label="Vérification en cours" />
        )}

        {state.kind === "disabled" && (
          <div className="space-y-2 text-[13px] leading-relaxed text-muted">
            <p>L&apos;assistant est désactivé : aucune clé API Claude n&apos;est configurée sur le serveur.</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>
                Ajoutez la ligne{" "}
                <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12px] text-fg">
                  ANTHROPIC_API_KEY=votre_clé
                </code>{" "}
                au fichier <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12px] text-fg">.env</code>.
              </li>
              <li>
                Lancez{" "}
                <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12px] text-fg">docker compose up -d</code>{" "}
                pour appliquer la configuration.
              </li>
            </ol>
          </div>
        )}
        </div>
      </CardContent>
    </Card>
  );
}
