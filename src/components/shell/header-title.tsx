"use client";

import { useId, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { greeting, headerTitle } from "@/lib/navigation";
import { cn } from "@/lib/cn";

function subscribeHour(onChange: () => void): () => void {
  // L'heure change rarement : une vérification par minute suffit (passage à midi, à 18 h).
  const timer = setInterval(onChange, 60_000);
  return () => clearInterval(timer);
}

/** Heure locale du navigateur (`null` au rendu serveur et pendant l'hydratation). */
function useLocalHour(): number | null {
  return useSyncExternalStore(
    subscribeHour,
    () => new Date().getHours(),
    () => null,
  );
}

/**
 * Titre de l'en-tête : salutation selon l'heure locale sur l'accueil, nom de la rubrique ailleurs.
 * Au chargement complet, un script en ligne pose la salutation avant l'affichage (le serveur ne
 * connaît pas l'heure du navigateur) ; React prend le relais ensuite.
 * `as` : balise du titre, `p` dans les en-têtes de l'application (défaut), `h1` comme titre de page
 * (accueil).
 */
export function HeaderTitle({ className, as: Tag = "p" }: { className?: string; as?: "p" | "h1" }) {
  const pathname = usePathname();
  const hour = useLocalHour();
  const id = useId();
  const title = headerTitle(pathname, hour);
  const isHome = pathname === "/";

  return (
    <>
      <Tag id={id} suppressHydrationWarning className={cn("truncate", className)}>
        {title}
      </Tag>
      {isHome && hour === null && (
        <script
          // Exécuté au rendu serveur seulement ; inerte côté client (pas d'avertissement React).
          type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `(function(){var e=document.getElementById(${JSON.stringify(id)});if(e)e.textContent=(${greeting.toString()})(new Date().getHours())})()`,
          }}
        />
      )}
    </>
  );
}
