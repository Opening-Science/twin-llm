"use client";

import { useId } from "react";

import {
  EFFORT_COPY,
  EFFORT_LEVELS,
  type EffortLevel,
} from "@/infrastructure/chat-effort";
import { buttonClassName } from "@/infrastructure/ui-kit/button";
import { ChevronIcon } from "@/infrastructure/ui-kit/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/infrastructure/ui-kit/popover";
import { cn } from "@/infrastructure/ui";

/**
 * The effort control of the prompt bar (#366): a button that names the step
 * and opens a slider over the five steps, with what the chosen step does in
 * one line. A native range input, so arrows, Home, End and a screen reader
 * work as for any slider; its value is read out by name. At Ultra the button
 * takes the Ultra tint (`.effort-ultra-text`).
 */
export const EffortMenu = ({
  effort,
  onChange,
}: Readonly<{ effort: EffortLevel; onChange: (effort: EffortLevel) => void }>) => {
  const sliderId = useId();
  const lineId = useId();
  const index = EFFORT_LEVELS.indexOf(effort);
  const copy = EFFORT_COPY[effort];
  return (
    <Popover>
      <PopoverTrigger
        className={buttonClassName({
          variant: "pill",
          size: "sm",
          className: cn("gap-1", effort === "ultra" && "effort-ultra-text"),
        })}
        aria-label={`Effort: ${copy.label}`}
      >
        <span>{copy.label}</span>
        <ChevronIcon className="size-3 rotate-90" />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        collisionPadding={16}
        className="w-[min(18rem,calc(100vw-2rem))] p-4"
      >
        <label htmlFor={sliderId} className="text-eyebrow flex justify-between">
          <span>Effort</span>
          <span className={cn("font-medium", effort === "ultra" && "effort-ultra-text")}>
            {copy.label}
          </span>
        </label>
        <input
          id={sliderId}
          type="range"
          min={0}
          max={EFFORT_LEVELS.length - 1}
          step={1}
          value={index}
          aria-valuetext={copy.label}
          aria-describedby={lineId}
          onChange={(event) =>
            onChange(EFFORT_LEVELS[Number(event.target.value)] ?? effort)
          }
          className="accent-primary mt-3 w-full"
        />
        <ol
          aria-hidden="true"
          className="text-muted-foreground mt-1 grid grid-cols-5 text-[11px]"
        >
          {EFFORT_LEVELS.map((level, i) => (
            <li
              key={level}
              className={cn(
                i === 0
                  ? "text-left"
                  : i === EFFORT_LEVELS.length - 1
                    ? "text-right"
                    : "text-center",
                level === effort && "text-foreground font-medium",
              )}
            >
              {EFFORT_COPY[level].label}
            </li>
          ))}
        </ol>
        <p id={lineId} className="text-muted-foreground mt-3 text-xs">
          {copy.line}
        </p>
      </PopoverContent>
    </Popover>
  );
};
