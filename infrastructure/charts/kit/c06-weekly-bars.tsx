"use client";

import { barsWithLine, weekdayLetters } from "./kit-geometry";
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
 */
export const WeeklyBars = ({
  category,
  state = "default",
  values,
  average,
  caption,
  hero,
  unit,
  weekStart = 1,
}: WeeklyBarsProps) => {
  const letters = weekdayLetters(weekStart);
  const slots = values.length || 7;
  return (
    <div className="flex flex-col gap-3" data-state={state}>
      {state === "loading" ? (
        <HeroSkeleton />
      ) : (
        <Hero
          hero={{ label: caption, value: state === "empty" ? "–" : hero, unit }}
          category={category}
          dot={false}
        />
      )}
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
                            : "fill-current"
                      }
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
                    className="stroke-current"
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
                  className={AXIS_TEXT}
                >
                  {letters[i % 7]}
                </text>
              ))}
            </>
          );
        }}
      </ChartSvg>
    </div>
  );
};
