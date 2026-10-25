import type { ReactNode } from "react";

import { cn } from "@/infrastructure/ui";

/**
 * A connection or job state, said in words.
 *
 * The text is required and always rendered: the dot's colour is a second
 * cue, never the only one, because a colour alone says nothing to a screen
 * reader or to someone who cannot tell green from red.
 *
 * Tones reuse tokens already measured for text contrast (`winner`,
 * `destructive`, `muted-foreground`). `off` is a hollow dot so "not set up"
 * still reads differently from "set up but idle" in greyscale.
 */

export type StatusTone = "neutral" | "ok" | "warn" | "off";

const TONE: Readonly<Record<StatusTone, { text: string; dot: string }>> = {
  ok: { text: "text-winner", dot: "bg-winner" },
  warn: { text: "text-destructive", dot: "bg-destructive" },
  neutral: { text: "text-muted-foreground", dot: "bg-muted-foreground" },
  off: { text: "text-muted-foreground", dot: "border-muted-foreground border" },
};

export type StatusBadgeProps = Readonly<{
  tone: StatusTone;
  children: ReactNode;
  className?: string;
}>;

export const StatusBadge = ({ tone, children, className }: StatusBadgeProps) => (
  <span
    data-tone={tone}
    className={cn(
      "inline-flex shrink-0 items-center gap-1.5 text-xs font-medium",
      TONE[tone].text,
      className,
    )}
  >
    <span className={cn("size-1.5 rounded-full", TONE[tone].dot)} aria-hidden />
    {children}
  </span>
);
