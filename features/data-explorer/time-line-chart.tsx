"use client";

import { useState } from "react";

import { formatDate, formatNumber } from "@/infrastructure/format-measure";

import { ChartTooltip, TooltipBody, useMeasuredWidth } from "./chart-frame";
import {
  extent,
  labelIndexes,
  nearestIndex,
  niceTicks,
  tickDecimals,
  yearTickTimes,
} from "./chart-geometry";

/**
 * One measurement over time for one subject: x is real time (a gap of five
 * years looks like five years), y is one axis in the series' own unit. A thin
 * line, dots while there are few enough to see, and a crosshair with a dot and
 * a tooltip at the reading nearest the pointer.
 */

export type TimePoint = Readonly<{ at: string; value: number }>;

const PAD = { top: 12, right: 12, bottom: 26, left: 56 } as const;
const DOTS_UP_TO = 80;

const dayOf = (iso: string): string => iso.slice(0, 10);

export const TimeLineChart = ({
  points,
  unit,
  decimals,
  label,
  height = 220,
}: {
  readonly points: readonly TimePoint[];
  readonly unit: string;
  readonly decimals: number;
  readonly label: string;
  readonly height?: number;
}) => {
  const [ref, width] = useMeasuredWidth(640);
  const [hover, setHover] = useState<number | null>(null);
  if (points.length === 0) return null;

  const times = points.map((point) => Date.parse(point.at));
  const values = points.map((point) => point.value);
  const [minValue, maxValue] = extent(values);
  const ticks = niceTicks(minValue, maxValue);
  const low = ticks[0]!;
  const high = ticks[ticks.length - 1]!;
  const [start, end] = extent(times);
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const xOf = (time: number) =>
    end === start
      ? PAD.left + plotW / 2
      : PAD.left + ((time - start) / (end - start)) * plotW;
  const yOf = (value: number) => PAD.top + plotH * (1 - (value - low) / (high - low));
  const xs = times.map(xOf);
  const path = points
    .map(
      (point, i) =>
        `${i === 0 ? "M" : "L"}${xs[i]!.toFixed(1)},${yOf(point.value).toFixed(1)}`,
    )
    .join(" ");
  const tickText = tickDecimals(ticks);
  const yearTicks = yearTickTimes(start, end);
  const shownYears = labelIndexes(yearTicks.length, Math.floor(plotW / 48)).map(
    (i) => yearTicks[i]!,
  );
  const hovered = hover === null ? null : points[hover];
  const valueText = (value: number) =>
    `${formatNumber(value, decimals)}${unit ? ` ${unit}` : ""}`;

  return (
    <div ref={ref} className="relative w-full">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block h-auto w-full"
        role="img"
        aria-label={label}
        onMouseLeave={() => setHover(null)}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const x = ((event.clientX - rect.left) / rect.width) * width;
          setHover(nearestIndex(xs, x));
        }}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={yOf(tick)}
              y2={yOf(tick)}
              className="stroke-border"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={yOf(tick) + 4}
              textAnchor="end"
              className="fill-muted-foreground font-mono text-[11px] tabular-nums"
            >
              {formatNumber(tick, tickText)}
            </text>
          </g>
        ))}
        <g className="text-chart-1">
          <path
            d={path}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {points.length <= DOTS_UP_TO &&
            points.map((point, i) => (
              <circle
                key={`${point.at}-${i}`}
                cx={xs[i]}
                cy={yOf(point.value)}
                r={2.5}
                fill="currentColor"
              />
            ))}
        </g>
        {shownYears.map((time) => {
          const x = xOf(time);
          return (
            <text
              key={time}
              x={x}
              y={height - 8}
              textAnchor={
                x <= PAD.left + 12
                  ? "start"
                  : x >= width - PAD.right - 12
                    ? "end"
                    : "middle"
              }
              className="fill-muted-foreground font-mono text-[11px]"
            >
              {new Date(time).getUTCFullYear()}
            </text>
          );
        })}
        {hovered && hover !== null && (
          <g>
            <line
              x1={xs[hover]}
              x2={xs[hover]}
              y1={PAD.top}
              y2={height - PAD.bottom}
              className="stroke-muted-foreground"
              strokeDasharray="3 3"
              strokeWidth={1}
            />
            <circle
              cx={xs[hover]}
              cy={yOf(hovered.value)}
              r={4.5}
              className="text-chart-1 stroke-card fill-current"
              strokeWidth={2}
            />
          </g>
        )}
      </svg>
      <ChartTooltip
        anchor={
          hovered && hover !== null ? { x: xs[hover]!, y: yOf(hovered.value) } : null
        }
        chart={{ width, height }}
      >
        {hovered && (
          <TooltipBody
            title={formatDate(dayOf(hovered.at))}
            rows={[["Value", valueText(hovered.value)]]}
          />
        )}
      </ChartTooltip>
    </div>
  );
};
