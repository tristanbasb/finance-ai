"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { safeNext } from "@/lib/auth/safe-next";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LogIn } from "lucide-react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        window.location.assign(
          safeNext(
            new URLSearchParams(window.location.search).get("next"),
            window.location.origin,
          ),
        );
        return;
      }
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      setError(data?.error ?? "Une erreur est survenue");
    } catch {
      setError("Impossible de joindre le serveur");
    }
    setLoading(false);
  }

  return (
    <main className="relative isolate flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-12">
      {/* Fond : deux halos doux aux couleurs du dégradé de marque. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-bg bg-[radial-gradient(60rem_40rem_at_15%_-10%,rgb(79_70_229/0.2),transparent_60%),radial-gradient(50rem_36rem_at_100%_110%,rgb(147_51_234/0.18),transparent_60%)]"
      />
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-5 text-center">
          <BrandMark className="size-14" />
          <div className="space-y-1.5">
            <h1 className="text-[28px] font-extrabold tracking-[-0.03em] text-fg">Finance AI</h1>
            <p className="text-sm text-muted">Connectez-vous pour retrouver vos comptes et vos budgets.</p>
          </div>
        </div>
        <form
          onSubmit={onSubmit}
          className="space-y-5 rounded-hero border border-border bg-surface p-6 shadow-pop sm:p-7"
        >
          <Input
            id="password"
            label="Mot de passe"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={error}
          />
          <Button type="submit" size="lg" loading={loading} className="w-full">
            {!loading && <LogIn aria-hidden />}
            {loading ? "Connexion…" : "Se connecter"}
          </Button>
        </form>
      </div>
    </main>
  );
}
