import { redirect } from "next/navigation";
import { redirectTargetFor } from "@/lib/patrimoine";

// Ancien chemin conservé pour les favoris. Le hash se perd parfois au redirect serveur :
// la rubrique passe en paramètre `section`, que /patrimoine convertit en défilement.
export default function SavingsRedirect(): never {
  redirect(redirectTargetFor("/savings")!);
}
