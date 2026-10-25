"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { LoaderCircle, LogOut, Settings, Sparkles, UserRound } from "lucide-react";
import { cn } from "@/lib/cn";
import { useLogout } from "@/components/logout-button";

const itemClass =
  "flex h-11 w-full items-center gap-3 px-4 text-left text-sm text-fg transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:opacity-60";

/**
 * Avatar de l'en-tête mobile → menu du compte (Assistant plein écran, Réglages, Déconnexion).
 * Bouton de menu accessible : `aria-expanded`, focus sur le premier choix à l'ouverture, flèches,
 * Début/Fin, Échap et clic en dehors ferment en rendant le focus à l'avatar.
 */
export function UserMenu() {
  const [open, setOpen] = useState(false);
  const { logout, pending } = useLogout();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  function items(): HTMLElement[] {
    return [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
  }

  function close(returnFocus = true) {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }

  // Focus sur le premier choix dès l'ouverture.
  useEffect(() => {
    if (open) items()[0]?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
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

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label="Menu du compte"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="inline-flex size-11 items-center justify-center rounded-full"
      >
        <span
          aria-hidden
          className={cn(
            "inline-flex size-9 items-center justify-center rounded-full bg-brand-gradient text-white shadow-glow transition-transform duration-150",
            open && "scale-95",
          )}
        >
          <UserRound className="size-[18px]" />
        </span>
      </button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Compte"
          onKeyDown={onMenuKeyDown}
          className={cn(
            "absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-2xl border border-border bg-surface py-1.5 text-fg shadow-pop",
            "origin-top-right transition-[opacity,scale] duration-150 ease-out starting:scale-95 starting:opacity-0",
          )}
        >
          <Link href="/assistant" role="menuitem" onClick={() => close(false)} className={itemClass}>
            <Sparkles aria-hidden className="size-[18px] text-brand" />
            Assistant
          </Link>
          <Link href="/settings" role="menuitem" onClick={() => close(false)} className={itemClass}>
            <Settings aria-hidden className="size-[18px] text-muted" />
            Réglages
          </Link>
          <div role="separator" className="my-1.5 h-px bg-border" />
          <button
            type="button"
            role="menuitem"
            onClick={() => void logout()}
            disabled={pending}
            className={itemClass}
          >
            {pending ? (
              <LoaderCircle aria-hidden className="size-[18px] animate-spin text-muted" />
            ) : (
              <LogOut aria-hidden className="size-[18px] text-muted" />
            )}
            Se déconnecter
          </button>
        </div>
      )}
    </div>
  );
}
