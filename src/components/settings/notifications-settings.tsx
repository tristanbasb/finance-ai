"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { controlClasses } from "@/components/ui/field";
import { errorMessage } from "@/lib/http";
import { cn } from "@/lib/cn";
import { HOUR_OPTIONS, numberToInput, parsePriceMovePct, parseUnusualMinEur, revertKeys } from "@/lib/settings-ui";

/** Les classes de champ sans hauteur ni largeur imposées (cn ne résout pas les conflits). */
const numberClasses = controlClasses.replace("h-10 w-full ", "");

type AlertPrefs = {
  enabled: boolean;
  budget: boolean;
  unusualExpense: boolean;
  unusualMinEur: number;
  priceMove: boolean;
  priceMovePct: number;
  goalReached: boolean;
};
type DigestPrefs = { weekly: boolean; monthly: boolean; hour: number };

async function save<T>(url: string, patch: Partial<T>): Promise<T> {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as T;
}

function failure(err: unknown) {
  toast.error("Réglage non enregistré", {
    description: err instanceof Error && err.message ? err.message : "Le serveur ne répond pas. Réessayez.",
  });
}

/** Champ numérique enregistré à la sortie du champ ou sur Entrée ; valeur invalide : message, rien n'est envoyé. */
function NumberField({
  label,
  prefix,
  suffix,
  value,
  parse,
  invalidMessage,
  onCommit,
}: {
  label: string;
  prefix?: string;
  suffix: string;
  value: number;
  parse: (raw: string) => number | null;
  invalidMessage: string;
  onCommit: (n: number) => Promise<boolean>;
}) {
  const id = useId();
  const [text, setText] = useState(numberToInput(value));
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState(value);

  // Resynchronise si la valeur enregistrée change (retour arrière après une erreur).
  if (seen !== value) {
    setSeen(value);
    setText(numberToInput(value));
  }

  async function commit() {
    const n = parse(text);
    if (n === null) {
      setError(invalidMessage);
      return;
    }
    setError(null);
    if (n === value) {
      setText(numberToInput(n));
      return;
    }
    const ok = await onCommit(n);
    if (!ok) setText(numberToInput(value));
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
      <label htmlFor={id}>{label}</label>
      {prefix && <span aria-hidden>{prefix}</span>}
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={text}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
          }
        }}
        className={cn(numberClasses, "h-9 w-24 text-right tabular-nums")}
      />
      <span aria-hidden>{suffix}</span>
      {error && (
        <p id={`${id}-error`} role="alert" className="basis-full text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Préférences d'une section, enregistrées de façon optimiste : mise à jour immédiate, envois
 * sérialisés, réponse appliquée seulement si c'est la dernière demande, échec : seules les clés
 * du patch sont rétablies.
 */
function usePrefs<T extends object>(url: string) {
  const [value, setValue] = useState<T | null>(null);
  const latest = useRef<T | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const seq = useRef(0);

  const apply = useCallback((updater: (prev: T | null) => T | null) => {
    latest.current = updater(latest.current);
    setValue(latest.current);
  }, []);

  const init = useCallback((initial: T) => apply(() => initial), [apply]);

  const patch = useCallback(
    (changes: Partial<T>): Promise<boolean> => {
      const previous = latest.current;
      if (!previous) return Promise.resolve(false);
      const id = ++seq.current;
      apply((p) => (p ? { ...p, ...changes } : p));
      const run = chain.current.then(async () => {
        try {
          const saved = await save<T>(url, changes);
          if (id === seq.current) apply(() => saved);
          return true;
        } catch (err) {
          apply((p) => (p ? revertKeys(p, previous, changes) : p));
          failure(err);
          return false;
        }
      });
      chain.current = run;
      return run;
    },
    [apply, url],
  );

  return { value, init, patch };
}

/** Section « Notifications » : alertes en temps réel et bilans, enregistrés au fil des changements. */
export function NotificationsSettings() {
  const alertsPrefs = usePrefs<AlertPrefs>("/api/settings/alerts");
  const digestsPrefs = usePrefs<DigestPrefs>("/api/settings/digests");
  const { init: initAlerts, patch: patchAlerts } = alertsPrefs;
  const { init: initDigests, patch: patchDigests } = digestsPrefs;
  const alerts = alertsPrefs.value;
  const digests = digestsPrefs.value;
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const [a, d] = await Promise.all([
          fetch("/api/settings/alerts", { cache: "no-store", signal: controller.signal }),
          fetch("/api/settings/digests", { cache: "no-store", signal: controller.signal }),
        ]);
        if (!a.ok || !d.ok) throw new Error();
        const [alertsBody, digestsBody] = (await Promise.all([a.json(), d.json()])) as [AlertPrefs, DigestPrefs];
        if (controller.signal.aborted) return;
        initAlerts(alertsBody);
        initDigests(digestsBody);
      } catch {
        if (!controller.signal.aborted) setLoadFailed(true);
      }
    })();
    return () => controller.abort();
  }, [initAlerts, initDigests]);

  const ready = alerts !== null && digests !== null;
  const subDisabled = alerts !== null && !alerts.enabled;

  return (
    <Card id="notifications" className="scroll-mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell aria-hidden className="size-4 text-muted" />
          Notifications
        </CardTitle>
        <CardDescription>
          Les alertes arrivent dans l&apos;application (la cloche) et sur Telegram si votre compte est relié. Les
          bilans partent à l&apos;heure choisie, heure du serveur.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5" aria-busy={!ready && !loadFailed}>
        {loadFailed && (
          <p role="alert" className="text-[13px] text-danger">
            Impossible de charger les réglages de notifications. Rechargez la page.
          </p>
        )}
        {!ready && !loadFailed && (
          <div className="space-y-3" aria-label="Chargement en cours">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-6 w-full animate-pulse rounded-full bg-surface-2" />
            ))}
          </div>
        )}

        {alerts && digests && (
          <>
            <section className="space-y-4" aria-labelledby="alerts-title">
              <h3 id="alerts-title" className="text-[13px] font-semibold uppercase tracking-wide text-subtle">
                Alertes
              </h3>
              <Switch
                label="Alertes en temps réel"
                description="Interrupteur général : désactivé, aucune alerte n'est envoyée."
                checked={alerts.enabled}
                onChange={(v) => void patchAlerts({ enabled: v })}
              />
              <div
                className={cn("space-y-4 border-l border-border pl-4 transition-opacity", subDisabled && "opacity-50")}
              >
                <Switch
                  label="Budget"
                  description="À 80 % et à 100 % du budget mensuel d'une catégorie."
                  checked={alerts.budget}
                  onChange={(v) => void patchAlerts({ budget: v })}
                />
                <div className="space-y-2">
                  <Switch
                    label="Dépenses inhabituelles"
                    description="Une dépense bien au-dessus de vos habitudes dans sa catégorie."
                    checked={alerts.unusualExpense}
                    onChange={(v) => void patchAlerts({ unusualExpense: v })}
                  />
                  <NumberField
                    label="À partir de"
                    suffix="€"
                    value={alerts.unusualMinEur}
                    parse={parseUnusualMinEur}
                    invalidMessage="Saisissez un montant d'au moins 1 €."
                    onCommit={(n) => patchAlerts({ unusualMinEur: n })}
                  />
                </div>
                <div className="space-y-2">
                  <Switch
                    label="Variations des investissements"
                    description="Une position qui bouge fortement en une journée."
                    checked={alerts.priceMove}
                    onChange={(v) => void patchAlerts({ priceMove: v })}
                  />
                  <NumberField
                    label="Variation de"
                    prefix="±"
                    suffix="%"
                    value={alerts.priceMovePct}
                    parse={parsePriceMovePct}
                    invalidMessage="Saisissez un pourcentage supérieur à 0."
                    onCommit={(n) => patchAlerts({ priceMovePct: n })}
                  />
                </div>
                <Switch
                  label="Objectifs atteints"
                  description="Quand un objectif d'épargne est atteint."
                  checked={alerts.goalReached}
                  onChange={(v) => void patchAlerts({ goalReached: v })}
                />
              </div>
            </section>

            <section className="space-y-4 border-t border-border pt-5" aria-labelledby="digests-title">
              <h3 id="digests-title" className="text-[13px] font-semibold uppercase tracking-wide text-subtle">
                Bilans
              </h3>
              <Switch
                label="Bilan hebdomadaire (lundi)"
                checked={digests.weekly}
                onChange={(v) => void patchDigests({ weekly: v })}
              />
              <Switch
                label="Bilan mensuel (le 1er)"
                checked={digests.monthly}
                onChange={(v) => void patchDigests({ monthly: v })}
              />
              <Select
                label="Heure d'envoi"
                hint="Heure du serveur."
                wrapperClassName="max-w-[10rem]"
                value={digests.hour}
                options={HOUR_OPTIONS}
                onChange={(e) => void patchDigests({ hour: Number(e.target.value) })}
              />
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}
