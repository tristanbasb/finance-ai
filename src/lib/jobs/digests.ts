import { runChat } from "@/lib/ai/chat";
import type { Ai } from "@/lib/ai/client";
import type { Db } from "@/lib/db";
import { todayLocal } from "@/lib/dates";
import { digestPeriod, type DigestKind } from "./periods";

export const DIGEST_TIMEOUT_MS = 120_000;
export const MIN_DIGEST_LENGTH = 200;
/** Texte de repli de `runChat` quand le modèle ne produit aucun texte. */
const REFUSAL_TEXT = "Je ne peux pas répondre à cette demande.";
export const AI_REQUIRED_NOTICE =
  "Les bilans automatiques nécessitent l'assistant IA : ajoutez votre clé API Claude (Réglages → Assistant IA).";

export function digestPrompt(kind: DigestKind, now: Date): string {
  const p = digestPeriod(kind, now);
  const what = kind === "weekly" ? "de la semaine écoulée" : "du mois écoulé";
  return `Rédige le bilan ${what}, du ${p.start} au ${p.end} (dates incluses).

Utilise les outils pour chaque chiffre (revenus, dépenses, solde, catégories principales, budgets dépassés ou proches de l'être, évolution des investissements, progression des objectifs) et compare avec la période précédente quand c'est utile. N'invente aucun montant.

Format : un bilan structuré mais concis, en sections introduites par une courte phrase en **gras** suivie de puces brèves (sans tableaux ni titres). Termine par une ou deux pistes d'attention concrètes. Ne répète pas le titre de la période : il est ajouté automatiquement.`;
}

/** Génère le texte du bilan (titre + corps) via `runChat` et les outils en lecture seule. */
export async function generateDigest(db: Db, ai: Ai, kind: DigestKind, now: Date): Promise<string> {
  const signal = AbortSignal.timeout(DIGEST_TIMEOUT_MS);
  let body = "";
  for await (const e of runChat({
    ai,
    db,
    messages: [{ role: "user", content: digestPrompt(kind, now) }],
    signal,
    today: todayLocal(now),
  })) {
    if (e.type === "text") body += e.text;
  }
  body = body.trim();
  if (body.length < MIN_DIGEST_LENGTH || body === REFUSAL_TEXT) throw new Error("bilan inutilisable");
  return `**${digestPeriod(kind, now).title}**\n\n${body}`;
}
