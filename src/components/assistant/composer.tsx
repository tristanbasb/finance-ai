"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { ArrowUp, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export const MAX_CONTENT = 8000;

export type ComposerProps = {
  /** Envoi d'une question ; le champ est vidé. */
  onSend: (text: string) => void;
  onStop: () => void;
  streaming: boolean;
  /** Assistant indisponible (aucune clé API) : saisie désactivée avec explication. */
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
};

/** Zone de saisie : Entrée envoie, Maj + Entrée passe à la ligne (compatible IME). */
export function Composer({ onSend, onStop, streaming, disabled = false, autoFocus = false, className }: ComposerProps) {
  const [input, setInput] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const id = useId();

  // Hauteur qui suit le texte (6 lignes environ au maximum).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  useEffect(() => {
    if (autoFocus && !disabled) ref.current?.focus({ preventScroll: true });
  }, [autoFocus, disabled]);

  function send() {
    const content = input.trim();
    if (!content || streaming || disabled) return;
    setInput("");
    onSend(content.slice(0, MAX_CONTENT));
    ref.current?.focus();
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    send();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // keyCode 229 : composition IME en cours sur certains navigateurs (Safari).
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      send();
    }
  }

  return (
    <form onSubmit={onSubmit} className={className}>
      <div
        className={cn(
          "flex items-end gap-2 rounded-xl border border-border bg-surface p-1.5 pl-3",
          "transition-[border-color,box-shadow] duration-150",
          disabled
            ? "bg-surface-2"
            : "hover:border-border-strong focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/20",
        )}
      >
        <label htmlFor={id} className="sr-only">
          Votre message à Claude
        </label>
        <textarea
          id={id}
          ref={ref}
          rows={1}
          value={input}
          maxLength={MAX_CONTENT}
          disabled={disabled}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={disabled ? "Assistant IA désactivé" : "Écrivez à Claude…"}
          aria-describedby={`${id}-hint`}
          className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-2 text-sm leading-5 text-fg placeholder:text-subtle focus:outline-none disabled:cursor-not-allowed"
        />
        {streaming ? (
          <Button variant="secondary" size="icon" onClick={onStop} aria-label="Arrêter la réponse" title="Arrêter">
            <Square aria-hidden className="fill-current" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            disabled={disabled || input.trim() === ""}
            aria-label="Envoyer le message"
            title="Envoyer"
          >
            <ArrowUp aria-hidden />
          </Button>
        )}
      </div>
      <p id={`${id}-hint`} className="mt-2 text-center text-[12px] leading-snug text-subtle">
        {disabled ? (
          <>
            Ajoutez une clé API Claude pour discuter.{" "}
            <Link href="/settings#ia" className="font-medium text-accent hover:underline">
              Voir les réglages
            </Link>
          </>
        ) : (
          <>
            Informations générales, pas un conseil financier personnalisé.
            <span className="hidden sm:inline"> Maj + Entrée pour un retour à la ligne.</span>
          </>
        )}
      </p>
    </form>
  );
}
