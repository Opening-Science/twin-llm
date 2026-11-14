"use client";

import { useId } from "react";

import {
  EFFORT_COPY,
  EFFORT_LEVELS,
  type EffortLevel,
} from "@/infrastructure/chat-effort";
import { Popover, PopoverContent, PopoverTrigger } from "@/infrastructure/ui-kit/popover";
import { cn } from "@/infrastructure/ui";

/**
 * Effort (SPEC 7.5): a pill naming the step opens a native range input over
 * the five steps, so arrows, Home and End and the screen reader come free.
 * The stop labels under it are decorative; the input's value text is the
 * step's name and its description the step's line.
 */

const PILL =
  "border-input hover:bg-muted text-foreground inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

export const EffortPicker = ({
  effort,
  onChange,
  disabled = false,
}: Readonly<{
  effort: EffortLevel;
  onChange: (effort: EffortLevel) => void;
  disabled?: boolean;
}>) => {
  const inputId = useId();
  const lineId = useId();
  const copy = EFFORT_COPY[effort];
  const index = EFFORT_LEVELS.indexOf(effort);
  return (
    <Popover>
      <PopoverTrigger
        className={PILL}
        disabled={disabled}
        aria-label={`Effort: ${copy.label}`}
      >
        <span className={cn(effort === "ultra" && "effort-ultra-text")}>
          {copy.label}
        </span>
      </PopoverTrigger>
      <PopoverContent side="top" className="w-80 p-4">
        <label htmlFor={inputId} className="flex items-baseline justify-between text-sm">
          <span className="font-medium">Effort</span>
          <span
            className={cn(
              "text-muted-foreground",
              effort === "ultra" && "effort-ultra-text",
            )}
          >
            {copy.label}
          </span>
        </label>
        <input
          id={inputId}
          type="range"
          min={0}
          max={EFFORT_LEVELS.length - 1}
          step={1}
          value={index}
          aria-valuetext={copy.label}
          aria-describedby={lineId}
          onChange={(event) => {
            const next = EFFORT_LEVELS[Number(event.target.value)];
            if (next !== undefined) onChange(next);
          }}
          className="accent-foreground mt-3 w-full"
        />
        {/* Stops under the thumb centres: the thumb is about 1rem wide. */}
        <div aria-hidden="true" className="relative mx-2 mt-1 h-4 text-[10px]">
          {EFFORT_LEVELS.map((level, at) => (
            <span
              key={level}
              className={cn(
                "text-muted-foreground absolute -translate-x-1/2 whitespace-nowrap",
                level === effort && "text-foreground font-medium",
              )}
              style={{ left: `${String((at / (EFFORT_LEVELS.length - 1)) * 100)}%` }}
            >
              {EFFORT_COPY[level].label}
            </span>
          ))}
        </div>
        <p id={lineId} className="text-muted-foreground mt-3 text-xs leading-snug">
          {copy.line}
        </p>
      </PopoverContent>
    </Popover>
  );
};
