"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, LogOut } from "lucide-react";
import { clearAssistantConversation } from "@/lib/assistant-storage";
import { cn } from "@/lib/cn";
import { toast } from "@/components/ui/toast";

/** Ferme la session puis renvoie vers /login (partagé par le bouton et le menu du compte). */
export function useLogout(): { logout: () => Promise<void>; pending: boolean } {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const logout = useCallback(async () => {
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
  }, [router]);

  return { logout, pending };
}

/** Bouton « Se déconnecter » (barre latérale, Réglages). */
export function LogoutButton({ className }: { className?: string }) {
  const { logout, pending } = useLogout();
  const Icon = pending ? LoaderCircle : LogOut;
  return (
    <button
      type="button"
      onClick={() => void logout()}
      disabled={pending}
      className={cn(
        "inline-flex h-10 w-full items-center gap-3 rounded-xl px-3 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-60 pointer-coarse:h-11",
        className,
      )}
    >
      <Icon aria-hidden className={cn("size-[18px]", pending && "animate-spin")} />
      <span>Se déconnecter</span>
    </button>
  );
}
