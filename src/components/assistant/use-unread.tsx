"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { takeNewUnread, type ThreadMessage } from "@/lib/assistant-thread";

/**
 * `lastId` : id du dernier message du fil, lu ou non (0 inconnu). `loaded` : faux tant que le
 * premier chargement n'a pas abouti.
 */
export type UnreadState = { count: number; latest: ThreadMessage[]; lastId: number; loaded: boolean };

export const UNREAD_POLL_MS = 20_000;

const EMPTY: UnreadState = { count: 0, latest: [], lastId: 0, loaded: false };

function isUnreadBody(value: unknown): value is Omit<UnreadState, "loaded" | "lastId"> & { lastId?: unknown } {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.count === "number" && Array.isArray(v.latest);
}

/**
 * Non-lus de Claude : `GET /api/messages/unread` au montage, toutes les 20 s quand l'onglet est
 * visible et au retour sur l'onglet. `onFresh` reçoit les messages apparus depuis le
 * chargement (jamais ceux du premier chargement), du plus ancien au plus récent.
 */
export function useUnread(onFresh: (messages: ThreadMessage[]) => void): {
  unread: UnreadState;
  refreshUnread: () => Promise<void>;
} {
  const [unread, setUnread] = useState<UnreadState>(EMPTY);
  const seen = useRef<Set<number> | null>(null);
  const onFreshRef = useRef(onFresh);
  const inFlight = useRef<Promise<void> | null>(null);

  useEffect(() => {
    onFreshRef.current = onFresh;
  }, [onFresh]);

  const refreshUnread = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    const run = (async () => {
      try {
        const res = await fetch("/api/messages/unread", { cache: "no-store" });
        if (!res.ok) return;
        const body: unknown = await res.json();
        if (!isUnreadBody(body)) return;
        const lastId = typeof body.lastId === "number" ? body.lastId : 0;
        setUnread({ count: body.count, latest: body.latest, lastId, loaded: true });
        if (seen.current === null) {
          // Premier chargement : rien à signaler, tout est considéré comme déjà vu.
          seen.current = new Set(body.latest.map((m) => m.id));
          return;
        }
        const fresh = takeNewUnread(body.latest, seen.current);
        if (fresh.length) onFreshRef.current(fresh);
      } catch {
        /* serveur injoignable : nouvel essai au prochain intervalle */
      } finally {
        inFlight.current = null;
      }
    })();
    inFlight.current = run;
    return run;
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void refreshUnread(), 0);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refreshUnread();
    }, UNREAD_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshUnread();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshUnread]);

  return { unread, refreshUnread };
}
