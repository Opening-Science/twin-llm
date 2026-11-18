"use client";

import { cn } from "@/infrastructure/ui";

import {
  ChartFocusFrame,
  ChartGroup,
  ChartReadout,
  dimmed,
  useChartFocus,
} from "./chart-focus";
import { barsWithLine, slotIndex, weekdayLetters } from "./kit-geometry";
import {
  AXIS_TEXT,
  ChartSvg,
  EMPTY_STROKE,
  Hero,
  HeroSkeleton,
  LOADING_FILL,
  toneClass,
} from "./kit-parts";
import type { WeeklyBarsProps } from "./types";

const HEIGHT = 132;
const PLOT = 108;
const LOADING_SHAPE = [0.5, 0.7, 0.4, 0.8, 0.6, 0.9, 0.55];

/**
 * C06: the caption and hero value, then a bar per day and the average as a
 * line across the whole width, so it reads as a baseline, not a data point.
 * With readouts, hover previews a day and a click or tap pins it (again to
 * clear); a finger drags across days and the arrow keys step. The focused
 * bar stays full, the others step back, and the readout names it.
 */
export const WeeklyBars = ({
  category,
  state = "default",
  values,
  readouts,
  average,
  caption,
  hero,
  unit,
  weekStart = 1,
  label,
  defaultFocus,
}: WeeklyBarsProps) => {
  const letters = weekdayLetters(weekStart);
  const slots = values.length || 7;
  const live = state === "default" && (readouts?.some(Boolean) ?? false);
  const focus = useChartFocus({
    count: values.length,
    pick: (x, _y, width) => slotIndex(x, width, values.length),
    defaultFocus,
    tap: true,
  });
  const focused = live ? focus.index : null;
  const chart = (
    <ChartSvg height={HEIGHT}>
      {(width) => {
        const box = { width, height: PLOT };
        const shape =
          state === "loading"
            ? LOADING_SHAPE
            : state === "empty"
              ? Array.from({ length: slots }, () => 1)
              : values;
        const out = barsWithLine(shape, state === "default" ? average : null, box);
        return (
          <>
            <g className={toneClass(category, false)}>
              {out.bars.map((bar, i) =>
                bar ? (
                  <rect
                    key={i}
                    {...bar}
                    rx={4}
                    className={
                      state === "loading"
                        ? LOADING_FILL
                        : state === "empty"
                          ? EMPTY_STROKE
                          : "kit-grow fill-current"
                    }
                    fillOpacity={dimmed(focused, i)}
                    strokeWidth={state === "empty" ? 1.5 : undefined}
                  />
                ) : null,
              )}
              {out.lineY !== null ? (
                <line
                  x1={0}
                  x2={width}
                  y1={out.lineY}
                  y2={out.lineY}
                  pathLength={1}
                  className="kit-draw stroke-current"
                  strokeWidth={2}
                />
              ) : null}
            </g>
            {out.centres.map((x, i) => (
              <text
                key={i}
                x={x}
                y={HEIGHT - 2}
                textAnchor="middle"
                // The focused day's letter is foreground; the others keep the
                // muted axis colour rather than fading below AA.
                className={cn(AXIS_TEXT, focused === i && "fill-foreground")}
              >
                {letters[i % 7]}
              </text>
            ))}
          </>
        );
      }}
    </ChartSvg>
  );
  const name = label ?? caption;
  return (
    // A picture is named here; an interactive chart by its focus frame.
    <ChartGroup
      label={live ? undefined : name}
      className="flex flex-col gap-3"
      data-state={state}
    >
      {state === "loading" ? (
        <HeroSkeleton />
      ) : (
        <Hero
          hero={{ label: caption, value: hero, unit }}
          missing={state === "empty"}
          category={category}
          dot={false}
        />
      )}
      {live ? (
        <>
          <ChartReadout
            id={focus.readoutId}
            text={focused === null ? null : readouts?.[focused]}
          />
          <ChartFocusFrame focus={focus} label={name}>
            {chart}
          </ChartFocusFrame>
        </>
      ) : (
        chart
      )}
    </ChartGroup>
  );
};
