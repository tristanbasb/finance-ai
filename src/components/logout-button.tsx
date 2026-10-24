"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, LogOut } from "lucide-react";
import { clearAssistantConversation } from "@/lib/assistant-storage";
import { cn } from "@/lib/cn";
import { toast } from "@/components/ui/toast";

/** Ferme la session puis renvoie vers /login. `compact` : icône seule (en-tête mobile). */
export function LogoutButton({ compact = false, className }: { compact?: boolean; className?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function logout() {
    setPending(true);
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (!res.ok) throw new Error();
      // La conversation de l'assistant contient des données financières : rien ne doit rester.
      clearAssistantConversation();
      router.replace("/login");
      router.refresh();
    } catch {
      setPending(false);
      toast.error("Déconnexion impossible", { description: "Le serveur ne répond pas. Réessayez." });
    }
  }

  const Icon = pending ? LoaderCircle : LogOut;
  return (
    <button
      type="button"
      onClick={logout}
      disabled={pending}
      aria-label={compact ? "Déconnexion" : undefined}
      className={cn(
        "inline-flex items-center gap-3 rounded-lg text-sm text-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-60",
        compact ? "size-9 justify-center" : "h-9 w-full px-3",
        className,
      )}
    >
      <Icon aria-hidden className={cn("size-[18px]", pending && "animate-spin")} />
      {!compact && <span>Déconnexion</span>}
    </button>
  );
}
