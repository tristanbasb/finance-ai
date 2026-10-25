"use client";

import { useId, useState, type FormEvent } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/http";

const CONFIRMATION = "RÉINITIALISER";

/**
 * « Réinitialiser l'application » : efface toutes les données (installation neuve) après
 * sauvegarde automatique. Confirmation par mot de passe et mot à saisir.
 */
export function ResetData() {
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [word, setWord] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const wordOk = word.trim().toLocaleUpperCase("fr-FR") === CONFIRMATION;

  function close() {
    if (busy) return;
    setOpen(false);
    setPassword("");
    setWord("");
    setError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!wordOk || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password, confirmation: word }),
      });
      if (!res.ok) {
        setError(await errorMessage(res));
        setBusy(false);
        return;
      }
      const { backup } = (await res.json()) as { backup?: string };
      toast.success("Application réinitialisée", {
        description: backup ? `Sauvegarde : backups/${backup}` : undefined,
      });
      // Rechargement complet : plus aucun état d'avant (fil, non-lus, caches) dans la page.
      window.setTimeout(() => window.location.replace(window.location.origin), 1200);
    } catch {
      setError("Le serveur est injoignable.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-danger/30 bg-danger/5 p-4">
      <div className="flex items-start gap-3">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-fg">Réinitialiser l&apos;application</p>
          <p className="text-[13px] leading-relaxed text-muted">
            Efface toutes vos données : opérations, comptes, positions, objectifs, budgets, conversation avec Claude
            et réglages. L&apos;application repart comme une installation neuve. Une sauvegarde complète est faite
            juste avant dans le dossier <code className="rounded bg-surface-2 px-1 py-0.5 text-[12px]">backups/</code>{" "}
            du serveur. Votre mot de passe ne change pas.
          </p>
        </div>
      </div>
      <Button variant="danger" onClick={() => setOpen(true)}>
        <RotateCcw aria-hidden />
        Réinitialiser…
      </Button>

      <Dialog
        open={open}
        onClose={close}
        size="sm"
        title="Réinitialiser l'application ?"
        description="Toutes vos données seront effacées. Une sauvegarde est faite avant, mais l'application, elle, repartira de zéro."
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={busy}>
              Annuler
            </Button>
            <Button type="submit" form={formId} variant="danger" disabled={!wordOk || !password} loading={busy}>
              {!busy && <RotateCcw aria-hidden />}
              Tout effacer
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={submit} className="space-y-4">
          <Input
            label="Mot de passe"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
          <Input
            label={`Saisissez ${CONFIRMATION} pour confirmer`}
            value={word}
            onChange={(e) => setWord(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            disabled={busy}
          />
          {error && (
            <p role="alert" className="text-[13px] text-danger">
              {error}
            </p>
          )}
        </form>
      </Dialog>
    </div>
  );
}
