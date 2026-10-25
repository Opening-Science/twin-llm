"use client";

import { cn } from "@/infrastructure/ui";

/**
 * A row of mutually exclusive choices that each take effect at once (a date
 * preset, single vs compare).
 *
 * Plain toggle buttons with `aria-pressed`, not Radix ToggleGroup: ToggleGroup
 * in single mode exposes radios with `aria-checked`, and the selected state
 * here has to be announced as "pressed", which is what a sighted user sees.
 * Before this existed the selected state was a background colour only, which
 * a screen reader cannot see at all.
 *
 * `value` may be null: a custom date range matches no preset, and pretending
 * one is pressed would be a lie.
 *
 * The look lives in `.segmented` / `.segmented-item` in `globals.css`, so a
 * server-rendered group of links (the leaderboard view toggle, which marks
 * its current link with `aria-current`) can share it without becoming a
 * client component.
 */

export type SegmentedOption<T extends string> = Readonly<{
  value: T;
  label: string;
}>;

export type SegmentedControlProps<T extends string> = Readonly<{
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  className?: string;
}>;

export const SegmentedControl = <T extends string>({
  label,
  options,
  value,
  onChange,
  size = "md",
  className,
}: SegmentedControlProps<T>) => (
  <div role="group" aria-label={label} className={cn("segmented", className)}>
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        aria-pressed={option.value === value}
        onClick={() => onChange(option.value)}
        className={cn("segmented-item", size === "sm" && "segmented-item-sm")}
      >
        {option.label}
      </button>
    ))}
  </div>
);
