"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { badgeCount, excerpt, kindLabel, relativeTime } from "@/lib/assistant-thread";
import { cn } from "@/lib/cn";
import { useAssistant } from "./assistant-provider";
import { KindIcon } from "./thread";

/**
 * Cloche des messages de Claude non lus : compteur, menu des 10 derniers (clic → fil centré sur
 * le message), « Tout marquer comme lu ». Navigation au clavier : flèches, Début/Fin, Échap.
 */
export function NotificationBell({
  placement = "dropdown",
  className,
}: {
  /** `dropdown` : menu aligné à droite sous la cloche ; `sheet` : pleine largeur sous l'en-tête mobile. */
  placement?: "dropdown" | "sheet";
  className?: string;
}) {
  const { unread, refreshUnread, openAt } = useAssistant();
  const [open, setOpen] = useState(false);
  const [marking, setMarking] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [now, setNow] = useState(() => Date.now());

  const count = unread.count;

  function items(): HTMLElement[] {
    return [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
  }

  function toggle(focusFirst = false) {
    if (open) {
      setOpen(false);
      return;
    }
    setNow(Date.now());
    setOpen(true);
    void refreshUnread();
    if (focusFirst) setTimeout(() => items()[0]?.focus(), 0);
  }

  function close(returnFocus = true) {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }

  // Clic en dehors ou Échap (focus sur la cloche) : fermeture.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        setOpen(false);
        if (rootRef.current?.contains(document.activeElement)) buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const move = (i: number) => {
      e.preventDefault();
      list[(i + list.length) % list.length]?.focus();
    };
    if (e.key === "ArrowDown") move(index + 1);
    else if (e.key === "ArrowUp") move(index < 0 ? list.length - 1 : index - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(list.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") setOpen(false);
  }

  async function markAll() {
    setMarking(true);
    try {
      const res = await fetch("/api/messages/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      if (!res.ok) throw new Error();
      await refreshUnread();
      close();
    } catch {
      toast.error("Marquage impossible", { description: "Le serveur ne répond pas. Réessayez." });
    } finally {
      setMarking(false);
    }
  }

  const label = count > 0 ? `Notifications, ${count} non lue${count > 1 ? "s" : ""}` : "Notifications";

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title="Notifications"
        onClick={() => toggle()}
        onKeyDown={(e) => {
          if ((e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") && !open) {
            e.preventDefault();
            toggle(true);
          }
        }}
        className={cn(
          "relative inline-flex size-10 items-center justify-center rounded-full transition-colors hover:bg-surface-2 hover:text-fg pointer-coarse:size-11",
          open ? "bg-surface-2 text-fg" : "text-muted",
        )}
      >
        <Bell aria-hidden className="size-[18px]" />
        {count > 0 && (
          <span
            aria-hidden
            className="num absolute right-1 top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-bg dark:text-bg"
          >
            {badgeCount(count)}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Messages de Claude non lus"
          onKeyDown={onMenuKeyDown}
          className={cn(
            "z-50 overflow-hidden rounded-xl border border-border bg-surface text-fg shadow-pop",
            "transition-[opacity,translate] duration-150 ease-out starting:-translate-y-1 starting:opacity-0",
            // En-tête mobile : menu sur toute la largeur sous l'en-tête ; ordinateur : sous la cloche.
            placement === "dropdown"
              ? "absolute right-0 top-full mt-2 w-[22rem]"
              : "fixed inset-x-4 top-[calc(3.5rem+env(safe-area-inset-top)+0.5rem)]",
          )}
        >
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
            <p className="text-[13px] font-semibold">Notifications</p>
            {count > 0 && (
              <button
                type="button"
                role="menuitem"
                onClick={() => void markAll()}
                disabled={marking}
                className="inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[12px] pointer-coarse:h-10 font-medium text-accent hover:bg-accent-soft disabled:opacity-60"
              >
                <CheckCheck aria-hidden className="size-3.5" />
                Tout marquer comme lu
              </button>
            )}
          </div>
          {unread.latest.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <Bell aria-hidden className="size-5 text-subtle" />
              <p className="text-[13px] text-muted">Aucune nouvelle notification</p>
            </div>
          ) : (
            <ul className="max-h-[min(26rem,70dvh)] divide-y divide-border overflow-y-auto">
              {unread.latest.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      close(false);
                      openAt(m.id);
                    }}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
                  >
                    <KindIcon kind={m.kind} className="mt-0.5" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="text-[13px] font-semibold">{kindLabel(m.kind)}</span>
                        <span className="shrink-0 text-[11px] text-subtle">{relativeTime(m.createdAt, now)}</span>
                      </span>
                      <span className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted">
                        {excerpt(m.content, 160)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {count > unread.latest.length && (
            <p className="border-t border-border px-4 py-2 text-[12px] text-subtle">
              {count - unread.latest.length} autre{count - unread.latest.length > 1 ? "s" : ""} message
              {count - unread.latest.length > 1 ? "s" : ""} non lu{count - unread.latest.length > 1 ? "s" : ""} dans le fil
            </p>
          )}
        </div>
      )}
    </div>
  );
}
