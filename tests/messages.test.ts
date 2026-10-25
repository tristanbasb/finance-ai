import { describe, expect, it } from "vitest";
import { createDb } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import {
  addMessage,
  contextMessages,
  listMessages,
  markRead,
  pendingUserMessages,
  unreadSummary,
} from "@/lib/queries/messages";

function freshDb() {
  const db = createDb(":memory:");
  runMigrations(db);
  return db;
}

const user = (db: ReturnType<typeof freshDb>, content: string, now: number) =>
  addMessage(db, { role: "user", kind: "chat", content, source: "app", now });
const asst = (db: ReturnType<typeof freshDb>, content: string, now: number, kind: "chat" | "alert" = "chat") =>
  addMessage(db, { role: "assistant", kind, content, source: "system", now });
const divider = (db: ReturnType<typeof freshDb>, now: number) =>
  addMessage(db, { role: "divider", kind: "divider", content: "", source: "app", now });

describe("messages : ajout, liste, pagination", () => {
  it("ajoute un message avec meta parsé", () => {
    const db = freshDb();
    const m = addMessage(db, {
      role: "assistant", kind: "alert", content: "Budget", source: "system", meta: { level: 80 }, now: 1000,
    });
    expect(m.id).toBeGreaterThan(0);
    expect(m.createdAt).toBe(1000);
    expect(m.readAt).toBeNull();
    expect(m.meta).toEqual({ level: 80 });
    expect(user(db, "x", 1001).meta).toBeNull();
  });

  it("liste en ordre chronologique avec limit et before (id)", () => {
    const db = freshDb();
    const ms = [1, 2, 3, 4, 5].map((i) => user(db, `m${i}`, i * 10));
    expect(listMessages(db, {}).map((m) => m.content)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
    expect(listMessages(db, { limit: 2 }).map((m) => m.content)).toEqual(["m4", "m5"]);
    expect(listMessages(db, { before: ms[3].id, limit: 2 }).map((m) => m.content)).toEqual(["m2", "m3"]);
    expect(listMessages(db, { limit: 9999 })).toHaveLength(5);
  });

  it("pagine sans doublon ni trou avec des created_at identiques", () => {
    const db = freshDb();
    for (let i = 1; i <= 7; i++) user(db, `m${i}`, 500);
    const p1 = listMessages(db, { limit: 3 });
    const p2 = listMessages(db, { before: p1[0].id, limit: 3 });
    const p3 = listMessages(db, { before: p2[0].id, limit: 3 });
    expect([...p3, ...p2, ...p1].map((m) => m.content)).toEqual(["m1", "m2", "m3", "m4", "m5", "m6", "m7"]);
  });
});

describe("messages : non-lus", () => {
  it("ignore user et divider, plus récents d'abord, max 10", () => {
    const db = freshDb();
    user(db, "u", 1);
    divider(db, 2);
    for (let i = 0; i < 12; i++) asst(db, `a${i}`, 10 + i);
    const s = unreadSummary(db);
    expect(s.count).toBe(12);
    expect(s.latest).toHaveLength(10);
    expect(s.latest[0].content).toBe("a11");
  });

  it("markRead par ids et all", () => {
    const db = freshDb();
    const a = asst(db, "a", 1);
    const b = asst(db, "b", 2);
    asst(db, "c", 3);
    expect(markRead(db, { ids: [a.id, b.id] }, 99)).toBe(2);
    expect(unreadSummary(db).count).toBe(1);
    expect(markRead(db, { all: true }, 100)).toBe(1);
    expect(unreadSummary(db).count).toBe(0);
    expect(listMessages(db, {})[0].readAt).toBe(99);
    expect(markRead(db, { all: true })).toBe(0);
  });
});

describe("contextMessages", () => {
  it("coupe au dernier divider", () => {
    const db = freshDb();
    user(db, "ancien", 1);
    asst(db, "vieux", 2);
    divider(db, 3);
    user(db, "nouveau", 4);
    asst(db, "ok", 5);
    expect(contextMessages(db, {})).toEqual([
      { role: "user", content: "nouveau" },
      { role: "assistant", content: "ok" },
    ]);
  });

  it("fusionne les messages consécutifs de même rôle et commence par user", () => {
    const db = freshDb();
    asst(db, "alerte", 1, "alert");
    user(db, "explique", 2);
    asst(db, "a1", 3);
    asst(db, "a2", 4);
    expect(contextMessages(db, {})).toEqual([
      { role: "user", content: "explique" },
      { role: "assistant", content: "a1\n\na2" },
    ]);
  });

  it("respecte maxMessages", () => {
    const db = freshDb();
    for (let i = 0; i < 10; i++) {
      user(db, `u${i}`, i * 2);
      asst(db, `a${i}`, i * 2 + 1);
    }
    const ctx = contextMessages(db, { maxMessages: 5 });
    expect(ctx).toHaveLength(4); // 5 derniers = a5? coupe -> retire l'assistant initial
    expect(ctx[0].role).toBe("user");
    expect(ctx.at(-1)).toEqual({ role: "assistant", content: "a9" });
  });

  it("respecte maxChars", () => {
    const db = freshDb();
    user(db, "u0", 1);
    asst(db, "a".repeat(100), 2);
    user(db, "u1", 3);
    asst(db, "b".repeat(100), 4);
    const ctx = contextMessages(db, { maxChars: 150 });
    expect(ctx).toEqual([
      { role: "user", content: "u1" },
      { role: "assistant", content: "b".repeat(100) },
    ]);
  });

  it("valeurs par défaut 40 / 30000", () => {
    const db = freshDb();
    for (let i = 0; i < 30; i++) {
      user(db, `u${i}`, i * 2);
      asst(db, `a${i}`, i * 2 + 1);
    }
    expect(contextMessages(db, {}).length).toBe(40);
  });

  it("conserve toujours le dernier élément, tronqué par le début", () => {
    const db = freshDb();
    user(db, "x".repeat(50) + "FIN", 1);
    expect(contextMessages(db, { maxChars: 10 })).toEqual([{ role: "user", content: "xxxxxxxFIN" }]);
    user(db, "y".repeat(20), 2);
    const ctx = contextMessages(db, { maxChars: 10 });
    expect(ctx).toHaveLength(1);
    expect(ctx[0].content).toBe("y".repeat(10));
  });

  it("seulement dividers ou assistant seul -> []", () => {
    const db = freshDb();
    divider(db, 1);
    divider(db, 2);
    expect(contextMessages(db, {})).toEqual([]);
    asst(db, "a", 3);
    expect(contextMessages(db, {})).toEqual([]);
  });

  it("ignore les lignes vides", () => {
    const db = freshDb();
    user(db, "q", 1);
    asst(db, "a1", 2);
    asst(db, "  ", 3);
    asst(db, "", 4);
    asst(db, "a2", 5);
    expect(contextMessages(db, {})).toEqual([
      { role: "user", content: "q" },
      { role: "assistant", content: "a1\n\na2" },
    ]);
  });
});

describe("messages en attente", () => {
  it("deferIds : messages replacés en fin de contexte", () => {
    const db = freshDb();
    const q1 = user(db, "Q1", 1);
    const q2 = user(db, "Q2", 2);
    asst(db, "R1", 3);
    expect(contextMessages(db, { deferIds: [q2.id] })).toEqual([
      { role: "user", content: "Q1" },
      { role: "assistant", content: "R1" },
      { role: "user", content: "Q2" },
    ]);
    expect(q1.id).toBeLessThan(q2.id);
  });

  it("pendingUserMessages : après meta.replyTo de la dernière réponse chat, puis du divider", () => {
    const db = freshDb();
    const q1 = user(db, "Q1", 1);
    expect(pendingUserMessages(db).map((m) => m.id)).toEqual([q1.id]);
    const q2 = user(db, "Q2", 2);
    addMessage(db, { role: "assistant", kind: "chat", content: "R1", source: "app", meta: { replyTo: q1.id }, now: 3 });
    expect(pendingUserMessages(db).map((m) => m.id)).toEqual([q2.id]);
    // Les alertes ne comptent pas comme réponse ; sans replyTo, l'id de la réponse fait foi.
    addMessage(db, { role: "assistant", kind: "alert", content: "A", source: "system", now: 4 });
    expect(pendingUserMessages(db).map((m) => m.id)).toEqual([q2.id]);
    asst(db, "R2", 5);
    expect(pendingUserMessages(db)).toEqual([]);
    user(db, "Q3", 6);
    divider(db, 7);
    expect(pendingUserMessages(db)).toEqual([]);
  });
});
