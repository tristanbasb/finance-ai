"use client";

import { useId, useState, type FormEvent } from "react";
import { CalendarCheck, CircleAlert, CircleCheck, Landmark, Repeat, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { controlClasses } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { affordMessage, parsePositiveAmount, type Afford } from "@/lib/forecast-ui";
import { errorMessage } from "@/lib/http";
import { formatEUR } from "@/lib/money";

type Tone = "positive" | "warning" | "danger";

const TONES: Record<Tone, { box: string; text: string }> = {
  positive: { box: "bg-positive-soft", text: "text-positive" },
  warning: { box: "bg-warning-soft", text: "text-warning" },
  danger: { box: "bg-danger-soft", text: "text-danger" },
};

/** Carte « Fin de mois » (Budgets, mois courant) : prévision et « Puis-je acheter… ? ». */
export function ForecastCard({
  checkingBalance,
  dueTotal,
  forecast,
  margin,
  className,
}: {
  checkingBalance: number;
  dueTotal: number;
  forecast: number;
  margin: number;
  className?: string;
}) {
  const tone: Tone = forecast < 0 ? "danger" : forecast < margin ? "warning" : "positive";
  const caption =
    tone === "danger"
      ? "Découvert prévu en fin de mois."
      : tone === "warning"
        ? `En dessous de votre marge de ${formatEUR(margin)}.`
        : margin > 0
          ? `Votre marge de ${formatEUR(margin)} est préservée.`
          : "Vous finissez le mois sans découvert.";

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarCheck aria-hidden className="size-4 text-brand" />
          Fin de mois
        </CardTitle>
        <CardDescription>Vos comptes courants, une fois les récurrentes du mois payées.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-3">
          <dl className="space-y-2 text-[13px]">
            <div className="flex items-center justify-between gap-3">
              <dt className="flex min-w-0 items-center gap-2 text-muted">
                <Landmark aria-hidden className="size-3.5 shrink-0" />
                Solde des comptes courants
              </dt>
              <dd className="num shrink-0 font-semibold text-fg">{formatEUR(checkingBalance)}</dd>
            </div>
            <div>
              <dt className="sr-only">Récurrentes à venir</dt>
              <dd className="num flex items-center gap-2 text-muted">
                <Repeat aria-hidden className="size-3.5 shrink-0" />− {formatEUR(dueTotal)} de récurrentes à venir
              </dd>
            </div>
          </dl>

          <div className={cn("space-y-1 rounded-card p-4", TONES[tone].box)}>
            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className={cn("text-[13px] font-semibold", TONES[tone].text)}>Fin de mois prévue :</span>
              <span className="num text-2xl font-bold tracking-[-0.025em] text-fg sm:text-[28px]">
                {formatEUR(forecast)}
              </span>
            </p>
            <p className="text-[12px] text-muted">{caption}</p>
          </div>
        </div>

        <AffordCheck />
      </CardContent>
    </Card>
  );
}

/** « Puis-je acheter… ? » : vérifie un prix contre la prévision du serveur (marge comprise). */
function AffordCheck() {
  const uid = useId();
  const inputId = `${uid}-price`;
  const errorId = `${uid}-error`;
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ tone: "ok" | "ko"; text: string } | null>(null);
  const [checking, setChecking] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = parsePositiveAmount(value);
    if (!parsed.ok) {
      setError(parsed.error);
      setResult(null);
      return;
    }
    setError(null);
    setChecking(true);
    try {
      const res = await fetch(`/api/forecast?price=${parsed.cents}`, { cache: "no-store" });
      if (!res.ok) {
        setError(await errorMessage(res));
        setResult(null);
        return;
      }
      const body = (await res.json()) as { margin: number; afford?: Afford };
      if (!body.afford) throw new Error("réponse incomplète");
      setResult(affordMessage(body.afford, body.margin));
    } catch {
      setError("Vérification impossible : le serveur est injoignable.");
      setResult(null);
    } finally {
      setChecking(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-2 border-t border-border pt-5">
      <label htmlFor={inputId} className="flex items-center gap-2 text-[13px] font-semibold text-fg">
        <ShoppingBag aria-hidden className="size-4 text-brand" />
        Puis-je acheter… ?
      </label>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <input
            id={inputId}
            inputMode="decimal"
            autoComplete="off"
            placeholder="Prix, ex. 129,90"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setResult(null);
              if (error) setError(null);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className={cn(controlClasses, "num pr-8")}
          />
          <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted">
            €
          </span>
        </div>
        <Button type="submit" variant="secondary" loading={checking}>
          {!checking && <CircleCheck aria-hidden />}
          Vérifier
        </Button>
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
      <div aria-live="polite">
        {result && (
          <p
            className={cn(
              "flex items-start gap-2 rounded-xl px-3 py-2.5 text-[13px] font-medium",
              result.tone === "ok" ? "bg-positive-soft text-positive" : "bg-danger-soft text-danger",
            )}
          >
            {result.tone === "ok" ? (
              <CircleCheck aria-hidden className="mt-px size-4 shrink-0" />
            ) : (
              <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
            )}
            <span className="num">{result.text}</span>
          </p>
        )}
      </div>
    </form>
  );
}
