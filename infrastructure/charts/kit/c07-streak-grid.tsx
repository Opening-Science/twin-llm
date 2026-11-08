import { cn } from "@/infrastructure/ui";

import { categoryTextClass } from "../category-token";
import { streakGrid, weekdayLetters } from "./kit-geometry";
import type { StreakGridProps } from "./types";

/**
 * C07: a seven-column month grid. Done days are filled in the category
 * colour, other days sit on the track, today is outlined, and each month's
 * first cell carries its short name.
 */
export const StreakGrid = ({
  category,
  state = "default",
  days,
  today,
  weekStart = 1,
}: StreakGridProps) => {
  const cells = streakGrid(days, today, weekStart);
  const rows = Math.max(4, ...cells.map((c) => c.row + 1));
  const tone = categoryTextClass(category);
  return (
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
            const cell = cells.find((c) => c.row * 7 + c.col === i);
            if (!cell) return <span key={i} className="aspect-square" />;
            return (
              <span
                key={cell.date}
                className={cn(
                  "text-axis flex aspect-square flex-col items-center justify-center rounded-[10px] font-mono leading-none tabular-nums",
                  cell.done
                    ? cn(tone, "bg-current")
                    : "bg-chart-track text-muted-foreground",
                  cell.today && "outline-foreground outline-2 outline-offset-1",
                )}
              >
                {/* The month sits inside its first cell, so it never covers a neighbour. */}
                {cell.month ? (
                  <span
                    className={cn(
                      "text-[9px]",
                      cell.done ? "text-card" : "text-muted-foreground",
                    )}
                  >
                    {cell.month}
                  </span>
                ) : null}
                <span className={cell.done ? "text-card font-bold" : undefined}>
                  {cell.day}
                </span>
              </span>
            );
          })}
    </div>
  );
};
