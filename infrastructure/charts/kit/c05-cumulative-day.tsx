"use client";

import { nearestIndex } from "../chart-geometry";
import { ChartFocusFrame, ChartReadout, useChartFocus } from "./chart-focus";
import {
  cumulativeDay,
  emptyDayOutline,
  PLACEHOLDER_DAY,
  samplesUpTo,
} from "./kit-geometry";
import { AXIS_TEXT, ChartSvg, EMPTY_STROKE, LOADING_FILL, toneClass } from "./kit-parts";
import type { CumulativeDayProps } from "./types";

const HEIGHT = 140;
const PLOT = 112;

/**
 * C05: today's running total in the category colour, ending in a dot at
 * now, over the usual day in grey. After now the usual day continues in the
 * same grey at lower opacity: the future is faded, not empty. With readouts
 * on today's samples, the sample nearest the pointer (or stepped to with
 * the keys) gets a hairline and a dot, and the readout names it.
 */
export const CumulativeDay = ({
  category,
  state = "default",
  today,
  average,
  now,
  axis = ["12 AM", "12 PM", "12 AM"],
  label,
  defaultFocus,
}: CumulativeDayProps) => {
  const samples = samplesUpTo(today, now);
  const live = state === "default" && samples.some((s) => s.readout);
  const focus = useChartFocus({
    count: samples.length,
    pick: (x, _y, width) => {
      const index = nearestIndex(
        samples.map((s) => s.at * width),
        x,
      );
      return index < 0 ? null : index;
    },
    defaultFocus,
  });
  const focused = live ? focus.index : null;
  const chart = (
    <ChartSvg height={HEIGHT}>
      {(width) => {
        const box = { width, height: PLOT };
        const day = cumulativeDay(state === "default" ? today : [], average, now, box);
        const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * width);
        const point = focused === null ? null : (day.points[focused] ?? null);
        return (
          <g data-state={state}>
            {state === "loading" ? (
              <rect
                x={0}
                y={PLOT / 3}
                width={width}
                height={(PLOT * 2) / 3}
                rx={12}
                className={LOADING_FILL}
              />
            ) : state === "empty" ? (
              <path
                // The usual day as a dotted outline, or a placeholder shape when
                // there is no usual day yet: never a blank card. The placeholder
                // is half as strong, so it never passes for the person's own day.
                d={cumulativeDay([], emptyDayOutline(average), 0, box).averageFuture}
                className={EMPTY_STROKE}
                strokeOpacity={
                  emptyDayOutline(average) === PLACEHOLDER_DAY ? 0.5 : undefined
                }
                strokeWidth={3}
                strokeDasharray="2 6"
                strokeLinecap="round"
              />
            ) : (
              <>
                <path
                  d={day.averagePast}
                  pathLength={1}
                  className="kit-draw stroke-chart-reference fill-none"
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d={day.averageFuture}
                  className="stroke-chart-reference fill-none"
                  strokeOpacity={0.45}
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <line
                  x1={day.nowX}
                  x2={day.nowX}
                  y1={0}
                  y2={PLOT}
                  className="stroke-border"
                  strokeWidth={1}
                />
                <g className={toneClass(category, false)}>
                  <path
                    d={day.today}
                    pathLength={1}
                    className="kit-draw fill-none stroke-current"
                    strokeWidth={3}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {point ? (
                    <line
                      x1={point.x}
                      x2={point.x}
                      y1={0}
                      y2={PLOT}
                      className="stroke-current"
                      strokeWidth={1}
                    />
                  ) : null}
                  {day.now ? (
                    <circle
                      cx={day.now.x}
                      cy={day.now.y}
                      r={6}
                      className="stroke-card fill-current"
                      strokeWidth={2}
                    />
                  ) : null}
                  {point ? (
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r={6}
                      className="stroke-card fill-current"
                      strokeWidth={2}
                    />
                  ) : null}
                </g>
              </>
            )}
            {ticks.map((x) => (
              <line
                key={x}
                x1={x}
                x2={x}
                y1={PLOT + 4}
                y2={PLOT + 8}
                className="stroke-muted-foreground"
                strokeDasharray="1 2"
              />
            ))}
            <text x={0} y={HEIGHT - 2} className={AXIS_TEXT}>
              {axis[0]}
            </text>
            <text x={width / 2} y={HEIGHT - 2} textAnchor="middle" className={AXIS_TEXT}>
              {axis[1]}
            </text>
            <text x={width} y={HEIGHT - 2} textAnchor="end" className={AXIS_TEXT}>
              {axis[2]}
            </text>
          </g>
        );
      }}
    </ChartSvg>
  );
  if (!live) return chart;
  return (
    <div className="flex flex-col gap-2">
      <ChartReadout
        id={focus.readoutId}
        text={focused === null ? null : samples[focused]?.readout}
      />
      <ChartFocusFrame focus={focus} label={label ?? "Today against a usual day"}>
        {chart}
      </ChartFocusFrame>
    </div>
  );
};
