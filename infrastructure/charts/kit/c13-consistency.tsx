"use client";

import { barsWithLine } from "./kit-geometry";
import {
  AXIS_TEXT,
  ChartSvg,
  EMPTY_STROKE,
  Hero,
  HeroSkeleton,
  LOADING_FILL,
  toneClass,
} from "./kit-parts";
import type { ConsistencyProps } from "./types";

const HEIGHT = 120;
const PLOT = 96;

/**
 * C13: the usual value and the last value as heroes, then a bar per day in
 * grey with the last one in the category colour, and the target as a line.
 */
export const Consistency = ({
  category,
  state = "default",
  values,
  target,
  reference,
  last,
  axis,
}: ConsistencyProps) => {
  const slots = values.length || 14;
  return (
    <div className="flex flex-col gap-3" data-state={state}>
      <div className="grid grid-cols-2 gap-4">
        {state === "loading" ? (
          <>
            <HeroSkeleton />
            <HeroSkeleton />
          </>
        ) : (
          <>
            <Hero pair hero={reference} category={category} reference />
            <Hero
              pair
              hero={state === "empty" ? { ...last, value: "–" } : last}
              category={category}
            />
          </>
        )}
      </div>
      <ChartSvg height={HEIGHT}>
        {(width) => {
          const shape =
            state === "default"
              ? values
              : Array.from({ length: slots }, (_, i) =>
                  state === "empty" ? 1 : 0.5 + (i % 3) * 0.2,
                );
          const out = barsWithLine(
            shape,
            state === "default" ? target : null,
            { width, height: PLOT },
            14,
            4,
          );
          const lastIndex = out.bars.findLastIndex((b) => b !== null);
          return (
            <>
              {out.bars.map((bar, i) =>
                bar ? (
                  <rect
                    key={i}
                    {...bar}
                    rx={bar.width / 2}
                    className={
                      state === "loading"
                        ? LOADING_FILL
                        : state === "empty"
                          ? EMPTY_STROKE
                          : i === lastIndex
                            ? `fill-current ${toneClass(category, false)}`
                            : "fill-chart-reference"
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
                  className={`stroke-current ${toneClass(category, false)}`}
                  strokeWidth={2}
                  strokeDasharray="4 4"
                />
              ) : null}
              {axis ? (
                <>
                  <text x={0} y={HEIGHT - 2} className={AXIS_TEXT}>
                    {axis[0]}
                  </text>
                  <text x={width} y={HEIGHT - 2} textAnchor="end" className={AXIS_TEXT}>
                    {axis[1]}
                  </text>
                </>
              ) : null}
            </>
          );
        }}
      </ChartSvg>
    </div>
  );
};
