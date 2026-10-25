"use client";

import { useEffect, useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/http";
import { cn } from "@/lib/cn";

type Model = { id: string; name: string };

/**
 * Choix du modèle Claude (liste de `GET /api/ai/models`, enregistrement par
 * `PUT /api/settings/model`). En cas d'échec, la valeur précédente est rétablie.
 */
export function ModelSelect({ className, label = "Modèle" }: { className?: string; label?: string }) {
  const id = useId();
  const [models, setModels] = useState<Model[] | null>(null);
  const [current, setCurrent] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/ai/models", { cache: "no-store", signal: controller.signal });
        if (!res.ok) throw new Error();
        const body = (await res.json()) as { models?: Model[]; current?: string };
        if (controller.signal.aborted) return;
        const list = Array.isArray(body.models) ? body.models : [];
        const chosen = typeof body.current === "string" ? body.current : "";
        // Modèle d'environnement absent de la liste : affiché tel quel pour rester exact.
        setModels(chosen && !list.some((m) => m.id === chosen) ? [{ id: chosen, name: chosen }, ...list] : list);
        setCurrent(chosen);
      } catch {
        if (!controller.signal.aborted) setModels([]);
      }
    })();
    return () => controller.abort();
  }, []);

  async function change(next: string) {
    const previous = current;
    setCurrent(next);
    setSaving(true);
    try {
      const res = await fetch("/api/settings/model", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: next }),
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      const name = models?.find((m) => m.id === next)?.name ?? next;
      toast.success("Modèle changé", { description: `Claude répondra avec ${name}.` });
    } catch (err) {
      setCurrent(previous);
      toast.error("Modèle inchangé", {
        description: err instanceof Error && err.message ? err.message : "Le serveur ne répond pas. Réessayez.",
      });
    } finally {
      setSaving(false);
    }
  }

  if (models !== null && models.length === 0) return null;

  return (
    <div className={cn("relative", className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        value={current}
        disabled={models === null || saving}
        onChange={(e) => void change(e.target.value)}
        title="Modèle Claude utilisé pour les réponses"
        className={cn(
          "h-8 max-w-[11.5rem] cursor-pointer appearance-none truncate rounded-lg border border-border bg-surface pl-2.5 pr-7 text-[13px] text-fg",
          "transition-[border-color] duration-150 hover:border-border-strong disabled:cursor-wait disabled:opacity-60",
        )}
      >
        {models === null ? (
          <option value="">Chargement…</option>
        ) : (
          models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))
        )}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-subtle"
      />
    </div>
  );
}
