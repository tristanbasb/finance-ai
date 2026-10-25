import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db";
import { settings } from "@/lib/db/schema";

export const alertPrefsSchema = z.object({
  enabled: z.boolean().default(true),
  budget: z.boolean().default(true),
  unusualExpense: z.boolean().default(true),
  unusualMinEur: z.number().min(1).default(100),
  priceMove: z.boolean().default(true),
  priceMovePct: z.number().positive().default(5),
  goalReached: z.boolean().default(true),
});
export type AlertPrefs = z.infer<typeof alertPrefsSchema>;

export const digestPrefsSchema = z.object({
  weekly: z.boolean().default(true),
  monthly: z.boolean().default(true),
  hour: z.number().int().min(0).max(23).default(8),
});
export type DigestPrefs = z.infer<typeof digestPrefsSchema>;

export const DEFAULT_ALERT_PREFS: AlertPrefs = alertPrefsSchema.parse({});
export const DEFAULT_DIGEST_PREFS: DigestPrefs = digestPrefsSchema.parse({});

/** Lit un réglage (JSON texte) ; absent, JSON invalide ou refusé par le schéma → `fallback`. */
export function getSetting<T>(db: Db, key: string, schema: z.ZodType<T>, fallback: T): T {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  if (!row) return fallback;
  try {
    const parsed = schema.safeParse(JSON.parse(row.value));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

export function setSetting(db: Db, key: string, value: unknown, now: number = Date.now()): void {
  const json = JSON.stringify(value);
  db.insert(settings)
    .values({ key, value: json, updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value: json, updatedAt: now } })
    .run();
}

export function deleteSetting(db: Db, key: string): void {
  db.delete(settings).where(eq(settings.key, key)).run();
}

/** Lecture seule : un seuil < 1 enregistré avant la règle « ≥ 1 € » est ramené à 1 (le PUT refuse < 1). */
const storedAlertPrefsSchema = z.preprocess((raw) => {
  if (raw && typeof raw === "object" && typeof (raw as { unusualMinEur?: unknown }).unusualMinEur === "number") {
    const v = raw as { unusualMinEur: number };
    if (v.unusualMinEur < 1) return { ...v, unusualMinEur: 1 };
  }
  return raw;
}, alertPrefsSchema);

export function alertPrefs(db: Db): AlertPrefs {
  return getSetting(db, "alerts", storedAlertPrefsSchema as z.ZodType<AlertPrefs>, DEFAULT_ALERT_PREFS);
}

export function digestPrefs(db: Db): DigestPrefs {
  return getSetting(db, "digests", digestPrefsSchema, DEFAULT_DIGEST_PREFS);
}

/** Modèle Claude choisi par l'utilisateur, ou null (→ modèle par défaut de l'app). */
export function getModelSetting(db: Db): string | null {
  return getSetting<string | null>(db, "claude_model", z.string().min(1), null);
}

export function setModelSetting(db: Db, model: string | null): void {
  if (model === null) deleteSetting(db, "claude_model");
  else setSetting(db, "claude_model", model);
}

/**
 * Fusionne un corps de PUT partiel avec les réglages actuels : seules les clés réellement
 * présentes dans `raw` écrasent l'existant (le `.default()` de zod 4 s'appliquerait sinon aux
 * clés absentes). L'objet fusionné est validé par le schéma complet.
 */
export function mergePrefs<T extends z.ZodObject>(schema: T, current: z.infer<T>, raw: unknown): z.infer<T> {
  const parsed = schema.partial().parse(raw) as Record<string, unknown>;
  const present = Object.fromEntries(Object.entries(parsed).filter(([k]) => Object.hasOwn(raw as object, k)));
  return schema.parse({ ...current, ...present });
}

/** « Autoriser Claude à modifier mes données » (tours déclenchés par l'utilisateur) ; vrai par défaut. */
export function aiCanWrite(db: Db): boolean {
  return getSetting(db, "ai_can_write", z.boolean(), true);
}

export function setAiCanWrite(db: Db, enabled: boolean): void {
  setSetting(db, "ai_can_write", enabled);
}
