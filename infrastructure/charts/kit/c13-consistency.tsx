"use client";

import { ChartFocusFrame, ChartReadout, dimmed, useChartFocus } from "./chart-focus";
import { barsWithLine, slotIndex } from "./kit-geometry";
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
 * With readouts, the night under the pointer or the keys stays full, the
 * others step back, and the readout names it. `floor` starts the bars above
 * zero, so a bedtime shift reads; `usual` draws the usual range as a band.
 */
export const Consistency = ({
  category,
  state = "default",
  values,
  target,
  reference,
  last,
  axis,
  readouts,
  label,
  defaultFocus,
  floor,
  usual,
}: ConsistencyProps) => {
  const slots = values.length || 14;
  const live = state === "default" && (readouts?.some(Boolean) ?? false);
  const focus = useChartFocus({
    count: values.length,
    pick: (x, _y, width) => slotIndex(x, width, values.length),
    defaultFocus,
  });
  const focused = live ? focus.index : null;
  const chart = (
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
          state === "default" ? { floor, band: usual } : {},
        );
        const lastIndex = out.bars.findLastIndex((b) => b !== null);
        return (
          <>
            {out.band ? (
              <>
                {/* The usual range behind the bars, named so it is never colour alone. */}
                <rect
                  x={0}
                  y={out.band.top}
                  width={width}
                  height={Math.max(2, out.band.bottom - out.band.top)}
                  rx={4}
                  className="fill-chart-reference"
                  fillOpacity={0.18}
                />
                <text x={0} y={Math.max(10, out.band.top - 4)} className={AXIS_TEXT}>
                  {usual?.label ?? "Usual"}
                </text>
              </>
            ) : null}
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
                          ? `kit-grow fill-current ${toneClass(category, false)}`
                          : "kit-grow fill-chart-reference"
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
  );
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
      {live ? (
        <>
          <ChartReadout
            id={focus.readoutId}
            text={focused === null ? null : readouts?.[focused]}
          />
          <ChartFocusFrame focus={focus} label={label ?? reference.label}>
            {chart}
          </ChartFocusFrame>
        </>
      ) : (
        chart
      )}
    </div>
  );
};
