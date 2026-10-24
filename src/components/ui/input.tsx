"use client";

import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { controlClasses, describedBy, Field } from "./field";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Classes du conteneur (libellé + champ). */
  wrapperClassName?: string;
};

/** Champ texte avec libellé, aide et erreur accessibles. */
export function Input({
  id,
  label,
  hint,
  error,
  className,
  wrapperClassName,
  ...props
}: InputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <Field id={inputId} label={label} hint={hint} error={error} className={wrapperClassName}>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(inputId, hint, error)}
        className={cn(controlClasses, className)}
        {...props}
      />
    </Field>
  );
}
