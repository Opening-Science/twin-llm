"use client";

import { type ReactNode, useId } from "react";

import { cn } from "@/infrastructure/ui";

/**
 * Small pieces the onboarding steps share. They stay in this feature: nothing
 * else in the app has step dots yet, and a primitive moves to the ui-kit the
 * day a second feature needs it (the switch did, for Customize · Connectors).
 */

export { Switch } from "@/infrastructure/ui-kit/switch";

/** A checkbox or radio drawn as a row you can click anywhere on. */
export const ChoiceOption = ({
  type,
  name,
  checked,
  onChange,
  label,
  hint,
}: {
  readonly type: "checkbox" | "radio";
  readonly name: string;
  readonly checked: boolean;
  readonly onChange: () => void;
  readonly label: string;
  readonly hint: string;
}) => {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors",
        checked ? "border-primary bg-muted" : "border-border hover:bg-muted/60",
      )}
    >
      <input
        id={id}
        type={type}
        name={name}
        checked={checked}
        onChange={onChange}
        className="accent-primary mt-0.5 size-4 shrink-0"
      />
      <span className="min-w-0 text-sm font-medium">
        {label}
        <span className="sr-only">, </span>
        <span className="text-muted-foreground block text-xs leading-relaxed font-normal">
          {hint}
        </span>
      </span>
    </label>
  );
};

/** One dot per step; the words are for screen readers, the dots for the eye. */
export const ProgressDots = ({
  step,
  total,
  label,
}: {
  readonly step: number;
  readonly total: number;
  readonly label: string;
}) => (
  <div className="flex items-center gap-1.5">
    <span className="sr-only">{label}</span>
    {Array.from({ length: total }, (_, index) => (
      <span
        key={index}
        aria-hidden
        className={cn(
          "h-1.5 rounded-full transition-all",
          index === step
            ? "bg-primary w-5"
            : index < step
              ? "bg-muted-foreground w-1.5"
              : "bg-border w-1.5",
        )}
      />
    ))}
  </div>
);

/** The quiet "change it later" line under a step. */
export const LaterNote = ({ children }: { readonly children: ReactNode }) => (
  <p className="text-muted-foreground mt-4 text-xs leading-relaxed">{children}</p>
);
