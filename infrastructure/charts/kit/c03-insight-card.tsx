import { cn } from "@/infrastructure/ui";
import { SegmentedControl } from "@/infrastructure/ui-kit/segmented-control";

import { categoryTextClass, tokenTextClass } from "../category-token";
import type { ChartRange, InsightCardProps } from "./types";

const RANGE_WORD: Readonly<Record<ChartRange, string>> = {
  day: "Day",
  week: "Week",
  month: "Month",
};

/**
 * C03, the card every chart sits in: a label row, one sentence, a hairline,
 * one body. The sentence is the chart's text for a screen reader, so the
 * body under it is hidden from assistive technology, unless the body is an
 * interactive chart: then its group and readout are read instead.
 *
 * `ranges` adds a Day / Week / Month switch to the header. The card only
 * reports the choice; the screen loads the data for it.
 */
export const InsightCard = ({
  category,
  series,
  state = "default",
  label,
  sentence,
  emptyNote,
  interactive = false,
  ranges,
  children,
}: InsightCardProps) => (
  <article
    className="surface rounded-card flex flex-col gap-3 p-5"
    aria-busy={state === "loading" ? true : undefined}
    data-state={state}
  >
    <header className="flex items-center gap-2 text-sm">
      <span
        aria-hidden="true"
        className={cn(
          "inline-block size-2.5 rounded-full bg-current",
          series ? tokenTextClass(series) : categoryTextClass(category),
        )}
      />
      <h3 className="text-foreground font-sans">{label}</h3>
      {ranges ? (
        <SegmentedControl
          label={`${label}: range`}
          size="sm"
          className="ml-auto"
          options={(ranges.options ?? ["day", "week", "month"]).map((value) => ({
            value,
            label: RANGE_WORD[value],
          }))}
          value={ranges.value}
          onChange={ranges.onChange}
        />
      ) : null}
    </header>
    {state === "loading" ? (
      <div className="space-y-2" role="status" aria-label="Loading">
        <div className="bg-chart-track h-5 w-full rounded-full motion-safe:animate-pulse" />
        <div className="bg-chart-track h-5 w-2/3 rounded-full motion-safe:animate-pulse" />
      </div>
    ) : (
      <p className="text-insight text-foreground font-sans">{sentence}</p>
    )}
    {children ? (
      <>
        <hr className="border-border" />
        <div aria-hidden={interactive ? undefined : true}>{children}</div>
      </>
    ) : null}
    {state === "empty" && emptyNote ? (
      <p className="text-muted-foreground font-mono text-xs tabular-nums">{emptyNote}</p>
    ) : null}
  </article>
);
