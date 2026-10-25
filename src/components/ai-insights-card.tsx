"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw, Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { INSIGHTS_ERROR_FALLBACK, readInsightsResponse } from "@/lib/insights-response";

type State =
  | { kind: "loading" }
  | { kind: "disabled" }
  | { kind: "ready"; insights: string[]; refreshing: boolean }
  | { kind: "error"; message: string };

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(url, { signal, cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Carte « Analyse IA » du mois. Toute réponse non OK de /api/ai/status vaut « IA indisponible » :
 * état désactivé discret, jamais d'erreur bloquante.
 */
export function AiInsightsCard({ month, monthLabel }: { month: string; monthLabel: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  const loadInsights = useCallback(
    async (refresh: boolean, signal?: AbortSignal) => {
      const url = `/api/ai/insights?month=${encodeURIComponent(month)}${refresh ? "&refresh=1" : ""}`;
      let outcome: ReturnType<typeof readInsightsResponse>;
      try {
        const res = await fetch(url, { signal, cache: "no-store" });
        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          /* corps absent ou illisible */
        }
        outcome = readInsightsResponse(res.status, body);
      } catch {
        outcome = { kind: "error", message: INSIGHTS_ERROR_FALLBACK };
      }
      if (signal?.aborted) return;
      setState(outcome.kind === "ready" ? { ...outcome, refreshing: false } : outcome);
    },
    [month],
  );

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      const status = await fetchJson<{ enabled?: boolean }>("/api/ai/status", controller.signal);
      if (controller.signal.aborted) return;
      if (!status?.enabled) {
        setState({ kind: "disabled" });
        return;
      }
      await loadInsights(false, controller.signal);
    })();
    return () => controller.abort();
  }, [loadInsights]);

  function refresh() {
    setState((s) => (s.kind === "ready" ? { ...s, refreshing: true } : { kind: "loading" }));
    void loadInsights(true);
  }

  const canRefresh = state.kind === "ready" || state.kind === "error";

  return (
    <Card className="flex h-full flex-col">
      <CardHeader
        action={
          canRefresh && (
            <Button
              variant="ghost"
              size="icon"
              onClick={refresh}
              disabled={state.kind === "ready" && state.refreshing}
              aria-label="Régénérer l'analyse"
              title="Régénérer l'analyse"
              className="-mr-2 -mt-1.5"
            >
              <RefreshCw
                aria-hidden
                className={cn(state.kind === "ready" && state.refreshing && "animate-spin")}
              />
            </Button>
          )
        }
      >
        <CardTitle className="flex items-center gap-2">
          <Sparkles aria-hidden className={cn("size-4", state.kind === "disabled" ? "text-subtle" : "text-accent")} />
          Analyse IA
        </CardTitle>
        <CardDescription className="first-letter:uppercase">{monthLabel}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1" aria-live="polite" aria-busy={state.kind === "loading"}>
        {state.kind === "loading" && (
          <div className="space-y-3" aria-label="Analyse en cours">
            {[92, 78, 85].map((w) => (
              <div key={w} className="h-3.5 animate-pulse rounded-full bg-surface-2" style={{ width: `${w}%` }} />
            ))}
          </div>
        )}

        {state.kind === "disabled" && (
          <div className="space-y-3 text-[13px] leading-relaxed text-muted">
            <p>Ajoutez votre clé API Claude pour activer les analyses.</p>
            <Link href="/settings#ia" className="inline-flex font-medium text-accent hover:underline">
              Ouvrir les réglages
            </Link>
          </div>
        )}

        {state.kind === "error" && (
          <p className="text-[13px] leading-relaxed text-muted">{state.message}</p>
        )}

        {state.kind === "ready" &&
          (state.insights.length === 0 ? (
            <p className="text-[13px] leading-relaxed text-muted">
              Pas encore assez d&apos;opérations ce mois-ci pour une analyse.
            </p>
          ) : (
            <ul className={cn("space-y-3 transition-opacity", state.refreshing && "opacity-50")}>
              {state.insights.map((text, i) => (
                <li key={i} className="flex gap-3 text-[13px] leading-relaxed text-fg">
                  <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent" />
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          ))}
      </CardContent>
    </Card>
  );
}
