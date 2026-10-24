"use client";

import { useId, type ReactNode, type SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { controlClasses, describedBy, Field } from "./field";

export type SelectOption = { value: string | number; label: string; disabled?: boolean };

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Options simples ; sinon passer des `<option>` en enfants. */
  options?: SelectOption[];
  /** Première option vide (valeur ""). */
  placeholder?: string;
  wrapperClassName?: string;
};

/** `<select>` natif stylé. */
export function Select({
  id,
  label,
  hint,
  error,
  options,
  placeholder,
  className,
  wrapperClassName,
  children,
  ...props
}: SelectProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <Field id={selectId} label={label} hint={hint} error={error} className={wrapperClassName}>
      <div className="relative">
        <select
          id={selectId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(selectId, hint, error)}
          className={cn(controlClasses, "cursor-pointer appearance-none pr-9", className)}
          {...props}
        >
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options?.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
          {children}
        </select>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-subtle"
        />
      </div>
    </Field>
  );
}
