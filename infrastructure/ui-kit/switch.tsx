"use client";

import { cn } from "@/infrastructure/ui";

/**
 * An on/off switch. `role="switch"` with `aria-checked`, a real button so
 * Space and Enter work, and a label that names what it turns on.
 */
export const Switch = ({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  readonly checked: boolean;
  readonly onChange: (next: boolean) => void;
  readonly label: string;
  readonly disabled?: boolean;
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={cn(
      "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50",
      checked ? "bg-primary border-primary" : "bg-muted border-input",
    )}
  >
    <span
      aria-hidden
      className={cn(
        "size-3.5 rounded-full transition-transform",
        checked
          ? "bg-primary-foreground translate-x-[17px]"
          : "bg-muted-foreground translate-x-0.5",
      )}
    />
  </button>
);
