"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/http";
import { botDeepLink, formatCountdown } from "@/lib/settings-ui";

type Status = { configured: boolean; linked: boolean; botUsername: string | null };
type LinkCode = { code: string; expiresAt: number };

const codeClasses = "rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12px] text-fg";

async function fetchStatus(signal?: AbortSignal): Promise<Status> {
  const res = await fetch("/api/telegram/status", { cache: "no-store", signal });
  if (!res.ok) throw new Error();
  const body = (await res.json()) as Partial<Status>;
  return {
    configured: body.configured === true,
    linked: body.linked === true,
    botUsername: typeof body.botUsername === "string" && body.botUsername ? body.botUsername : null,
  };
}

function Commands() {
  return (
    <p className="text-[13px] leading-relaxed text-muted">
      Commandes du bot : <code className={codeClasses}>/nouveau</code> (nouvelle conversation),{" "}
      <code className={codeClasses}>/bilan</code> (bilan à la demande), <code className={codeClasses}>/modele</code>{" "}
      (changer de modèle), <code className={codeClasses}>/aide</code>.
    </p>
  );
}

function CodeCard({
  code,
  botUsername,
  now,
  onRegenerate,
  busy,
}: {
  code: LinkCode;
  botUsername: string | null;
  now: number;
  onRegenerate: () => void;
  busy: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const left = code.expiresAt - now;
  const expired = left <= 0;
  const bot = botUsername ? `@${botUsername}` : "votre bot";
  const command = `/start ${code.code}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.warning("Copie impossible", { description: "Sélectionnez le code et copiez-le à la main." });
    }
  }

  if (expired) {
    return (
      <div className="space-y-3 rounded-xl border border-border bg-surface-2 p-4">
        <p role="status" className="text-sm font-medium text-fg">
          Code expiré
        </p>
        <p className="text-[13px] text-muted">Le code n&apos;est plus valable. Générez-en un nouveau.</p>
        <Button onClick={onRegenerate} loading={busy}>
          Générer un nouveau code
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-border bg-surface-2 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <p
          aria-label={`Code de liaison ${code.code.split("").join(" ")}`}
          className="font-mono text-3xl font-semibold tracking-[0.25em] text-fg"
        >
          {code.code}
        </p>
        <Button variant="secondary" size="sm" onClick={() => void copy()}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? "Copié" : "Copier /start"}
        </Button>
      </div>
      <p className="text-sm leading-relaxed text-fg">
        Envoyez <code className={codeClasses}>{command}</code> à <strong className="font-semibold">{bot}</strong> dans
        Telegram.
      </p>
      {botUsername && (
        <a
          href={botDeepLink(botUsername, code.code)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
        >
          Ouvrir dans Telegram
          <ExternalLink aria-hidden className="size-3.5" />
        </a>
      )}
      <p className="text-[13px] text-muted">
        Expire dans <span className="font-mono tabular-nums text-fg">{formatCountdown(left)}</span>. En attente de
        votre message…
      </p>
    </div>
  );
}

/** Section « Telegram » : non configuré, configuré non relié (code de liaison) ou relié. */
export function TelegramSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [code, setCode] = useState<LinkCode | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchStatus(controller.signal)
      .then((s) => {
        if (!controller.signal.aborted) setStatus(s);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadFailed(true);
      });
    return () => controller.abort();
  }, []);

  const showingCode = code !== null && status?.linked === false;

  // Compte à rebours.
  useEffect(() => {
    if (!showingCode) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [showingCode, code?.code]);

  const expired = code !== null && code.expiresAt - now <= 0;

  // Surveille la liaison tant qu'un code valable est affiché.
  useEffect(() => {
    if (!showingCode || expired) return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      fetchStatus(controller.signal)
        .then((s) => {
          if (controller.signal.aborted) return;
          if (s.linked) {
            setStatus(s);
            setCode(null);
            toast.success("Telegram relié");
          } else {
            setStatus((prev) => (prev && prev.botUsername !== s.botUsername ? { ...prev, botUsername: s.botUsername } : prev));
          }
        })
        .catch(() => {
          /* réessai au prochain tour */
        });
    }, 3000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [showingCode, expired]);

  const generate = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/telegram/link", { method: "POST" });
      if (!res.ok) throw new Error(await errorMessage(res));
      const body = (await res.json()) as { code: string; expiresAt: number; botUsername: string | null };
      setNow(Date.now());
      setCode({ code: body.code, expiresAt: body.expiresAt });
      if (body.botUsername) setStatus((prev) => (prev ? { ...prev, botUsername: body.botUsername } : prev));
    } catch (err) {
      toast.error("Code non généré", {
        description: err instanceof Error && err.message ? err.message : "Le serveur ne répond pas. Réessayez.",
      });
    } finally {
      setBusy(false);
    }
  }, []);

  async function unlink() {
    setBusy(true);
    try {
      const res = await fetch("/api/telegram/link", { method: "DELETE" });
      if (!res.ok) throw new Error(await errorMessage(res));
      setStatus((prev) => (prev ? { ...prev, linked: false } : prev));
      setCode(null);
      setConfirmUnlink(false);
      toast.success("Telegram délié");
    } catch (err) {
      toast.error("Telegram toujours relié", {
        description: err instanceof Error && err.message ? err.message : "Le serveur ne répond pas. Réessayez.",
      });
    } finally {
      setBusy(false);
    }
  }

  const bot = status?.botUsername ? `@${status.botUsername}` : "votre bot";

  return (
    <Card id="telegram" className="scroll-mt-6">
      <CardHeader
        action={
          status?.linked ? (
            <Badge variant="positive">Relié</Badge>
          ) : status && !status.configured ? (
            <Badge>Non configuré</Badge>
          ) : null
        }
      >
        <CardTitle className="flex items-center gap-2">
          <Send aria-hidden className="size-4 text-muted" />
          Telegram
        </CardTitle>
        <CardDescription>Recevez vos alertes et bilans, et discutez avec l&apos;assistant depuis Telegram.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4" aria-live="polite" aria-busy={status === null && !loadFailed}>
        {status === null && !loadFailed && <div className="h-4 w-48 animate-pulse rounded-full bg-surface-2" aria-label="Vérification en cours" />}
        {loadFailed && (
          <p role="alert" className="text-[13px] text-danger">
            Impossible de lire l&apos;état de Telegram. Rechargez la page.
          </p>
        )}

        {status && !status.configured && (
          <div className="space-y-2 text-[13px] leading-relaxed text-muted">
            <p>Telegram n&apos;est pas configuré : aucun bot n&apos;est renseigné sur le serveur.</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>
                Ouvrez{" "}
                <a
                  href="https://t.me/BotFather"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-accent hover:underline"
                >
                  @BotFather
                </a>{" "}
                dans Telegram et envoyez <code className={codeClasses}>/newbot</code>.
              </li>
              <li>Copiez le jeton (token) que BotFather vous donne.</li>
              <li>
                Ajoutez la ligne <code className={codeClasses}>TELEGRAM_BOT_TOKEN=&lt;jeton&gt;</code> au fichier{" "}
                <code className={codeClasses}>.env</code> du serveur.
              </li>
              <li>
                Lancez <code className={codeClasses}>./update.sh --force</code> ou redémarrez le conteneur.
              </li>
            </ol>
          </div>
        )}

        {status?.configured && !status.linked && (
          <>
            {code === null ? (
              <div className="space-y-3">
                <p className="text-[13px] leading-relaxed text-muted">
                  Le bot est configuré, mais aucun compte Telegram n&apos;est relié. Générez un code, puis envoyez-le à{" "}
                  {bot}.
                </p>
                <Button onClick={() => void generate()} loading={busy}>
                  Relier mon compte
                </Button>
              </div>
            ) : (
              <CodeCard code={code} botUsername={status.botUsername} now={now} onRegenerate={() => void generate()} busy={busy} />
            )}
            <Commands />
          </>
        )}

        {status?.configured && status.linked && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-fg">
                Compte relié à <strong className="font-semibold">{bot}</strong>
              </p>
              <Button variant="secondary" onClick={() => setConfirmUnlink(true)}>
                Délier
              </Button>
            </div>
            <Commands />
          </>
        )}
      </CardContent>

      <Dialog
        open={confirmUnlink}
        onClose={() => (busy ? undefined : setConfirmUnlink(false))}
        title="Délier Telegram ?"
        description="Les alertes et les bilans ne seront plus envoyés sur Telegram, et le bot ne répondra plus à votre compte."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmUnlink(false)} disabled={busy}>
              Annuler
            </Button>
            <Button variant="danger" onClick={() => void unlink()} loading={busy}>
              Délier
            </Button>
          </>
        }
      />
    </Card>
  );
}
