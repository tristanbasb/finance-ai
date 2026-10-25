import { withErrors } from "@/lib/api";
import { getDb } from "@/lib/db";
import { addMessage } from "@/lib/queries/messages";

export const dynamic = "force-dynamic";

/** Nouvelle conversation : insère un séparateur (le contexte de Claude repart de zéro) → 201. */
export const POST = withErrors(async () => {
  const message = addMessage(getDb(), { role: "divider", kind: "divider", content: "", source: "app" });
  return Response.json({ message }, { status: 201 });
});
