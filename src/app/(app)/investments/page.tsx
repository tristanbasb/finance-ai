import { redirect } from "next/navigation";
import { redirectTargetFor } from "@/lib/patrimoine";

// Voir /savings : même mécanisme, vers la rubrique Investissements.
export default function InvestmentsRedirect(): never {
  redirect(redirectTargetFor("/investments")!);
}
