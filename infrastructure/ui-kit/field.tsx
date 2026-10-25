"use client";

import { useId, type ComponentProps, type ReactNode } from "react";

import { cn } from "@/infrastructure/ui";

/**
 * A label, one control, and an optional hint or error, wired together.
 *
 * A placeholder is not a label: it disappears the moment someone types and
 * is not reliably announced. Every input gets a visible `<label for>` here,
 * and the hint or error is tied to the control with `aria-describedby` so it
 * is read out with it, not just shown near it.
 *
 * The error is a sentence the caller wrote, never a raw provider message.
 */

const CONTROL =
  "border-input bg-background text-foreground w-full rounded-md border px-2 py-1.5 text-sm aria-invalid:border-destructive";

type FieldBase = Readonly<{
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
}>;

type InputFieldProps = FieldBase &
  Readonly<{ as?: "input" }> &
  Readonly<Omit<ComponentProps<"input">, "id" | "className">>;

type SelectFieldProps = FieldBase &
  Readonly<{ as: "select" }> &
  Readonly<Omit<ComponentProps<"select">, "id" | "className">>;

export type FieldProps = InputFieldProps | SelectFieldProps;

const withoutAs = <T extends Readonly<{ as?: string }>>({
  as: _as,
  ...rest
}: T): Omit<T, "as"> => rest;

export const Field = ({
  label,
  hint,
  error,
  className,
  "aria-describedby": describedBy,
  ...control
}: FieldProps) => {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  // A caller may already point at its own description; keep it and add ours.
  const describedByIds =
    [describedBy, note === undefined ? undefined : noteId].filter(Boolean).join(" ") ||
    undefined;
  const wiring = {
    id,
    "aria-describedby": describedByIds,
    "aria-invalid": error === undefined ? undefined : true,
    className: CONTROL,
  } as const;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="text-muted-foreground text-xs font-medium">
        {label}
      </label>
      {control.as === "select" ? (
        <select {...withoutAs(control)} {...wiring} />
      ) : (
        <input {...withoutAs(control)} {...wiring} />
      )}
      {note !== undefined && (
        <p
          id={noteId}
          className={cn(
            "text-xs",
            error === undefined ? "text-muted-foreground" : "text-destructive",
          )}
        >
          {note}
        </p>
      )}
    </div>
  );
};
