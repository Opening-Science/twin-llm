"use client";

import { cn } from "@/infrastructure/ui";

/** An invisible `::before` past the track, so a finger has at least 24px to hit. */
export const SWITCH_HIT_AREA =
  "before:absolute before:-inset-x-1 before:-inset-y-1.5 before:content-['']";

/**
 * An on/off switch. `role="switch"` with `aria-checked`, a real button so
 * Space and Enter work, and a label that names what it turns on. The track
 * is 20px high; an invisible `::before` reaches 5px past it above and
 * below and 3px at the sides, so a finger has 30 by 42px to hit, past the
 * 24px minimum, and nothing around it moves.
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
      SWITCH_HIT_AREA,
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
