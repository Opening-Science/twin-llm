"use client";

import { rangeBars } from "./kit-geometry";
import { AXIS_TEXT, ChartSvg, EMPTY_STROKE, LOADING_FILL, toneClass } from "./kit-parts";
import type { RangeBarsProps } from "./types";

const HEIGHT = 168;
const TOP = 22;
const PLOT = 112;
const LOADING_SHAPE = Array.from({ length: 12 }, (_, i) => ({
  min: 40 + (i % 4) * 5,
  max: 70 + (i % 3) * 8,
}));

const whole = (value: number): string => String(Math.round(value));

/**
 * C08: one rounded bar from each bucket's minimum to its maximum, with MIN
 * and MAX written as words beside the extreme bars rather than in a tooltip.
 */
export const RangeBars = ({
  category,
  state = "default",
  buckets,
  axis,
  format = whole,
}: RangeBarsProps) => (
  <ChartSvg height={HEIGHT}>
    {(width) => {
      const box = { width, height: PLOT };
      const shape =
        state === "loading"
          ? LOADING_SHAPE
          : state === "empty"
            ? (buckets.length ? buckets : LOADING_SHAPE).map(() => ({ min: 0, max: 1 }))
            : buckets;
      const out = rangeBars(shape, box);
      const low = out.bars[out.lowest];
      const high = out.bars[out.highest];
      return (
        <g data-state={state}>
          <g transform={`translate(0 ${TOP})`} className={toneClass(category, false)}>
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
                        : "fill-current"
                  }
                  strokeWidth={state === "empty" ? 1.5 : undefined}
                />
              ) : null,
            )}
            {state === "default" && high ? (
              <text
                x={high.x + high.width / 2}
                y={high.y - 8}
                textAnchor="middle"
                className="text-axis fill-current font-mono tabular-nums"
              >
                MAX {format(out.max)}
              </text>
            ) : null}
            {state === "default" && low ? (
              <text
                x={low.x + low.width / 2}
                y={low.y + low.height + 16}
                textAnchor="middle"
                className="text-axis fill-current font-mono tabular-nums"
              >
                MIN {format(out.min)}
              </text>
            ) : null}
          </g>
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
        </g>
      );
    }}
  </ChartSvg>
);
