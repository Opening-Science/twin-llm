"use client";

import { EMPTY_VALUE, formatNumber } from "@/infrastructure/format-measure";

import {
  ChartFocusFrame,
  ChartGroup,
  ChartReadout,
  dimmed,
  useChartFocus,
} from "./chart-focus";
import { rangeBars, slotIndex } from "./kit-geometry";
import { AXIS_TEXT, ChartSvg, EMPTY_STROKE, LOADING_FILL, toneClass } from "./kit-parts";
import type { RangeBarsProps } from "./types";

const HEIGHT = 168;
const TOP = 22;
const PLOT = 112;
const LOADING_SHAPE = Array.from({ length: 12 }, (_, i) => ({
  min: 40 + (i % 4) * 5,
  max: 70 + (i % 3) * 8,
}));

/** Whole numbers through the shared formatter: a missing value reads "—". */
const whole = (value: number): string => formatNumber(value, 0);

/** "114 bpm" when the bars have a unit, "114" when not; a missing value is "—" alone. */
export const withUnit = (value: string, unit: string | undefined): string =>
  unit && value !== EMPTY_VALUE ? `${value} ${unit}` : value;

/**
 * C08: one rounded bar from each bucket's minimum to its maximum, with MIN
 * and MAX written as words beside the extreme bars rather than in a tooltip.
 * With readouts, the bucket under the pointer or the keys stays full, the
 * others step back, and the readout names it.
 */
export const RangeBars = ({
  category,
  state = "default",
  buckets,
  axis,
  format = whole,
  unit,
  label,
  defaultFocus,
}: RangeBarsProps) => {
  const live = state === "default" && buckets.some((b) => b?.readout);
  const focus = useChartFocus({
    count: buckets.length,
    pick: (x, _y, width) => slotIndex(x, width, buckets.length),
    defaultFocus,
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
                          : "kit-grow-centre fill-current"
                    }
                    fillOpacity={dimmed(focused, i)}
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
                  MAX {withUnit(format(out.max), unit)}
                </text>
              ) : null}
              {state === "default" && low ? (
                <text
                  x={low.x + low.width / 2}
                  y={low.y + low.height + 16}
                  textAnchor="middle"
                  className="text-axis fill-current font-mono tabular-nums"
                >
                  MIN {withUnit(format(out.min), unit)}
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
  if (!live) return <ChartGroup label={label ?? "Range per hour"}>{chart}</ChartGroup>;
  return (
    <div className="flex flex-col gap-2">
      <ChartReadout
        id={focus.readoutId}
        text={focused === null ? null : buckets[focused]?.readout}
      />
      <ChartFocusFrame focus={focus} label={label ?? "Range per hour"}>
        {chart}
      </ChartFocusFrame>
    </div>
  );
};
