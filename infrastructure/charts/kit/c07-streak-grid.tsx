"use client";

import { cn } from "@/infrastructure/ui";

import { categoryTextClass } from "../category-token";
import {
  ChartFocusFrame,
  ChartReadout,
  mutedUnlessFocused,
  useChartFocus,
} from "./chart-focus";
import { streakGrid, weekdayLetters, weekStep } from "./kit-geometry";
import type { StreakGridProps } from "./types";

/**
 * C07: a seven-column month grid. Done days are filled in the category
 * colour, other days sit on the track, today is outlined, and each month's
 * first cell carries its short name. With readouts, a click or tap pins a
 * day (again to clear), hover previews one, Left and Right step a day and
 * Up and Down a week; the other days step back and the readout names the focused one.
 */
export const StreakGrid = ({
  category,
  state = "default",
  days,
  today,
  weekStart = 1,
  label,
  defaultFocus,
}: StreakGridProps) => {
  const cells = streakGrid(days, today, weekStart);
  const rows = Math.max(4, ...cells.map((c) => c.row + 1));
  const tone = categoryTextClass(category);
  const live = state === "default" && cells.some((c) => c.readout);
  const focus = useChartFocus({
    count: cells.length,
    defaultFocus,
    tap: true,
    // Left and Right step a day; Up and Down a week, on the same weekday.
    step: (key, current) => weekStep(key, current, cells),
  });
  const focused = live ? focus.index : null;
  const grid = (
    <div className="grid grid-cols-7 gap-1.5" data-state={state}>
      {weekdayLetters(weekStart).map((letter, i) => (
        <span key={i} className="text-muted-foreground text-axis text-center font-mono">
          {letter}
        </span>
      ))}
      {state !== "default"
        ? Array.from({ length: rows * 7 }, (_, i) => (
            <span
              key={i}
              className={cn(
                "aspect-square rounded-[10px]",
                state === "loading"
                  ? "bg-chart-track motion-safe:animate-pulse"
                  : "border-chart-reference border",
              )}
            />
          ))
        : Array.from({ length: rows * 7 }, (_, i) => {
            const at = cells.findIndex((c) => c.row * 7 + c.col === i);
            const cell = cells[at];
            if (!cell) return <span key={i} className="aspect-square" />;
            // A done day that steps back keeps its colour as an outline, and
            // its number takes the muted colour, so nothing falls below AA.
            const back = mutedUnlessFocused(focused, at);
            const filled = cell.done && !back;
            return (
              <span
                key={cell.date}
                data-focus-index={live ? at : undefined}
                className={cn(
                  "text-axis flex aspect-square flex-col items-center justify-center rounded-[10px] font-mono leading-none tabular-nums",
                  filled
                    ? cn(tone, "bg-current")
                    : cell.done
                      ? cn(tone, "border-2 border-current")
                      : "bg-chart-track text-muted-foreground",
                  cell.today && "outline-foreground outline-2 outline-offset-1",
                  focused === at && "ring-ring ring-offset-card ring-2 ring-offset-2",
                )}
              >
                {/* The month sits inside its first cell, so it never covers a neighbour. */}
                {cell.month ? (
                  <span
                    className={cn(
                      "text-[9px]",
                      filled ? "text-card" : "text-muted-foreground",
                    )}
                  >
                    {cell.month}
                  </span>
                ) : null}
                <span
                  className={
                    filled
                      ? "text-card font-bold"
                      : cell.done
                        ? "text-muted-foreground font-bold"
                        : undefined
                  }
                >
                  {cell.day}
                </span>
              </span>
            );
          })}
    </div>
  );
  if (!live) return grid;
  return (
    <div className="flex flex-col gap-2">
      <ChartReadout
        id={focus.readoutId}
        text={focused === null ? null : cells[focused]?.readout}
      />
      <ChartFocusFrame focus={focus} label={label ?? "Days"}>
        {grid}
      </ChartFocusFrame>
    </div>
  );
};
