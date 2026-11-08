"use client";

import { cumulativeDay } from "./kit-geometry";
import { AXIS_TEXT, ChartSvg, EMPTY_STROKE, LOADING_FILL, toneClass } from "./kit-parts";
import type { CumulativeDayProps } from "./types";

const HEIGHT = 140;
const PLOT = 112;

/**
 * C05: today's running total in the category colour, ending in a dot at
 * now, over the usual day in grey. After now the usual day continues in the
 * same grey at lower opacity: the future is faded, not empty.
 */
export const CumulativeDay = ({
  category,
  state = "default",
  today,
  average,
  now,
  axis = ["12 AM", "12 PM", "12 AM"],
}: CumulativeDayProps) => (
  <ChartSvg height={HEIGHT}>
    {(width) => {
      const box = { width, height: PLOT };
      const day = cumulativeDay(state === "default" ? today : [], average, now, box);
      const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * width);
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
              d={cumulativeDay([], average, 0, box).averageFuture}
              className={EMPTY_STROKE}
              strokeWidth={3}
              strokeDasharray="2 6"
              strokeLinecap="round"
            />
          ) : (
            <>
              <path
                d={day.averagePast}
                className="stroke-chart-reference fill-none"
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
                  className="fill-none stroke-current"
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {day.now ? (
                  <circle
                    cx={day.now.x}
                    cy={day.now.y}
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
