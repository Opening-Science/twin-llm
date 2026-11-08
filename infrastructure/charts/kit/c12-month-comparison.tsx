import { cn } from "@/infrastructure/ui";

import { categoryTextClass } from "../category-token";
import { monthShares } from "./kit-geometry";
import type { MonthComparisonProps } from "./types";

/**
 * C12: this month and last month as horizontal bars on one scale, the value
 * above each bar and the month's name inside it. This month is in the
 * category colour, last month on the track.
 */
export const MonthComparison = ({
  category,
  state = "default",
  current,
  previous,
}: MonthComparisonProps) => {
  const shares = monthShares(current.value, previous.value);
  const rows = [
    { ...current, share: shares.current, now: true },
    { ...previous, share: shares.previous, now: false },
  ];
  return (
    <div className="space-y-3" data-state={state}>
      {rows.map((row) => (
        <div key={row.month} className="space-y-1">
          <p className="text-foreground font-mono text-lg font-bold tabular-nums">
            {state === "default" ? row.display : "–"}
          </p>
          <div
            className={cn(
              "flex h-8 items-center rounded-lg px-3 font-mono text-xs",
              state === "loading" && "bg-chart-track w-full motion-safe:animate-pulse",
              state === "empty" &&
                "border-chart-reference text-muted-foreground w-full border",
              state === "default" &&
                (row.now
                  ? cn(categoryTextClass(category), "bg-current")
                  : "bg-chart-track text-foreground"),
            )}
            style={
              state === "default"
                ? { width: `${Math.max(row.share * 100, 18)}%` }
                : undefined
            }
          >
            {state !== "loading" ? (
              <span
                className={
                  state === "default" && row.now ? "text-card font-bold" : undefined
                }
              >
                {row.month}
              </span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
};
