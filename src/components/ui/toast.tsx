"use client";

import { useSyncExternalStore } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/cn";

export type ToastVariant = "default" | "success" | "warning" | "error";

export type ToastOptions = {
  variant?: ToastVariant;
  description?: string;
  /** Durée d'affichage en ms (défaut 4 s, 6 s pour un avertissement ou une erreur). */
  duration?: number;
};

type ToastItem = { id: number; message: string; description?: string; variant: ToastVariant };

const MAX_VISIBLE = 4;
const EMPTY: ToastItem[] = [];

let items: ToastItem[] = EMPTY;
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Ferme une notification. */
export function dismissToast(id: number): void {
  items = items.filter((t) => t.id !== id);
  emit();
}

/** Affiche une notification (côté client) ; renvoie son identifiant. */
export function toast(message: string, options: ToastOptions = {}): number {
  const id = nextId++;
  const variant = options.variant ?? "default";
  items = [...items, { id, message, description: options.description, variant }].slice(-MAX_VISIBLE);
  emit();
  const duration = options.duration ?? (variant === "error" || variant === "warning" ? 6000 : 4000);
  setTimeout(() => dismissToast(id), duration);
  return id;
}

toast.success = (message: string, options: Omit<ToastOptions, "variant"> = {}) =>
  toast(message, { ...options, variant: "success" });
toast.warning = (message: string, options: Omit<ToastOptions, "variant"> = {}) =>
  toast(message, { ...options, variant: "warning" });
toast.error = (message: string, options: Omit<ToastOptions, "variant"> = {}) =>
  toast(message, { ...options, variant: "error" });

const icons = {
  default: <Info aria-hidden className="size-4 text-muted" />,
  success: <CircleCheck aria-hidden className="size-4 text-positive" />,
  warning: <TriangleAlert aria-hidden className="size-4 text-warning" />,
  error: <CircleAlert aria-hidden className="size-4 text-danger" />,
} as const;

/** Zone d'affichage des notifications ; à placer une fois dans la mise en page. */
export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => items, () => EMPTY);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-24 z-50 flex flex-col items-center gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:items-end"
    >
      {list.map((t) => (
        <div
          key={t.id}
          role={t.variant === "error" ? "alert" : "status"}
          className={cn(
            "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-pop",
            "transition-[opacity,translate] duration-200 ease-out starting:translate-y-2 starting:opacity-0",
          )}
        >
          <span className="mt-0.5">{icons[t.variant]}</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-fg">{t.message}</p>
            {t.description && <p className="mt-0.5 text-[13px] text-muted">{t.description}</p>}
          </div>
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            aria-label="Fermer la notification"
            className="-mr-1 inline-flex size-6 items-center justify-center rounded-md text-subtle hover:bg-surface-2 hover:text-fg"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
