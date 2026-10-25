import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createDb } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { settings } from "@/lib/db/schema";
import {
  alertPrefs, alertPrefsSchema, DEFAULT_ALERT_PREFS, DEFAULT_DIGEST_PREFS, digestPrefs, getModelSetting, getSetting,
  setModelSetting, setSetting,
} from "@/lib/settings";

function freshDb() {
  const db = createDb(":memory:");
  runMigrations(db);
  return db;
}

describe("réglages", () => {
  it("défaut si absent", () => {
    const db = freshDb();
    expect(getSetting(db, "x", z.string(), "def")).toBe("def");
    expect(alertPrefs(db)).toEqual(DEFAULT_ALERT_PREFS);
    expect(digestPrefs(db)).toEqual(DEFAULT_DIGEST_PREFS);
    expect(getModelSetting(db)).toBeNull();
  });

  it("valeurs par défaut attendues", () => {
    expect(DEFAULT_ALERT_PREFS).toEqual({
      enabled: true, budget: true, unusualExpense: true, unusualMinEur: 100,
      priceMove: true, priceMovePct: 5, goalReached: true,
    });
    expect(DEFAULT_DIGEST_PREFS).toEqual({ weekly: true, monthly: true, hour: 8 });
  });

  it("défaut si JSON invalide ou schéma invalide", () => {
    const db = freshDb();
    db.insert(settings).values({ key: "k", value: "{pas du json", updatedAt: 1 }).run();
    expect(getSetting(db, "k", z.string(), "def")).toBe("def");
    setSetting(db, "k", 42);
    expect(getSetting(db, "k", z.string(), "def")).toBe("def");
    setSetting(db, "digests", { hour: 99 });
    expect(digestPrefs(db)).toEqual(DEFAULT_DIGEST_PREFS);
  });

  it("aller-retour et upsert", () => {
    const db = freshDb();
    setSetting(db, "k", { a: 1 });
    setSetting(db, "k", { a: 2 });
    expect(getSetting(db, "k", z.object({ a: z.number() }), { a: 0 })).toEqual({ a: 2 });
    setSetting(db, "alerts", { budget: false });
    expect(alertPrefs(db)).toEqual({ ...DEFAULT_ALERT_PREFS, budget: false });
  });

  it("seuil des dépenses inhabituelles : au moins 1 €", () => {
    expect(alertPrefsSchema.safeParse({ unusualMinEur: 0 }).success).toBe(false);
    expect(alertPrefsSchema.safeParse({ unusualMinEur: 0.5 }).success).toBe(false);
    expect(alertPrefsSchema.parse({ unusualMinEur: 1 }).unusualMinEur).toBe(1);
  });

  it("réglage du modèle", () => {
    const db = freshDb();
    setModelSetting(db, "claude-opus-4");
    expect(getModelSetting(db)).toBe("claude-opus-4");
    setModelSetting(db, null);
    expect(getModelSetting(db)).toBeNull();
  });
});
