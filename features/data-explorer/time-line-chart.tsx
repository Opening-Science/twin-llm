"use client";

import { type PointerEvent as ReactPointerEvent, useState } from "react";

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
 *
 * For playback over one night: an hour axis, a cursor held at one reading,
 * a pointer that seeks, and a line that breaks over a gap instead of bridging
 * it, so a missing stretch never looks measured.
 */

export type TimePoint = Readonly<{ at: string; value: number }>;

const PAD = { top: 12, right: 12, bottom: 26, left: 56 } as const;
const DOTS_UP_TO = 80;

const dayOf = (iso: string): string => iso.slice(0, 10);
const clockOf = (time: number): string => new Date(time).toISOString().slice(11, 16);

const HOUR_MS = 3_600_000;

/** Whole hours inside [start, end], every `step` hours, as UTC wall clock. */
export const hourTickTimes = (
  start: number,
  end: number,
  step = 2,
): readonly number[] => {
  const first = Math.ceil(start / HOUR_MS) * HOUR_MS;
  const count = Math.max(0, Math.floor((end - first) / (HOUR_MS * step)) + 1);
  return Array.from({ length: count }, (_, i) => first + i * HOUR_MS * step);
};

/** "M" starts a new run of the line wherever two readings are further apart than `breakOverMs`. */
export const linePath = (
  xs: readonly number[],
  ys: readonly number[],
  times: readonly number[],
  breakOverMs: number,
): string =>
  xs
    .map((x, i) => {
      const jump = i === 0 || times[i]! - times[i - 1]! > breakOverMs;
      return `${jump ? "M" : "L"}${x.toFixed(1)},${ys[i]!.toFixed(1)}`;
    })
    .join(" ");

export const TimeLineChart = ({
  points,
  unit,
  decimals,
  label,
  height = 220,
  timeAxis = "years",
  cursorIndex = null,
  onSeek,
  breakOverMs = Infinity,
}: {
  readonly points: readonly TimePoint[];
  readonly unit: string;
  readonly decimals: number;
  readonly label: string;
  readonly height?: number;
  /** Years for a life; hours (UTC wall clock) for one night. */
  readonly timeAxis?: "years" | "hours";
  /** A reading held under the crosshair while the pointer is elsewhere. */
  readonly cursorIndex?: number | null;
  /** Pressing or dragging on the chart asks for the nearest reading. */
  readonly onSeek?: (index: number) => void;
  readonly breakOverMs?: number;
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
  const path = linePath(xs, values.map(yOf), times, breakOverMs);
  const tickText = tickDecimals(ticks);
  const xTicks =
    timeAxis === "hours" ? hourTickTimes(start, end) : yearTickTimes(start, end);
  const shownYears = labelIndexes(xTicks.length, Math.floor(plotW / 48)).map(
    (i) => xTicks[i]!,
  );
  const xTickText = (time: number): string =>
    timeAxis === "hours" ? clockOf(time) : String(new Date(time).getUTCFullYear());
  const shownIndex = hover ?? cursorIndex;
  const hovered = shownIndex === null ? null : (points[shownIndex] ?? null);
  const seekAt = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return nearestIndex(xs, ((event.clientX - rect.left) / rect.width) * width);
  };
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
        onPointerDown={
          onSeek
            ? (event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                onSeek(seekAt(event));
              }
            : undefined
        }
        onPointerMove={(event) => {
          const index = seekAt(event);
          setHover(index);
          if (onSeek && event.buttons === 1) onSeek(index);
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
              {xTickText(time)}
            </text>
          );
        })}
        {hovered && shownIndex !== null && (
          <g>
            <line
              x1={xs[shownIndex]}
              x2={xs[shownIndex]}
              y1={PAD.top}
              y2={height - PAD.bottom}
              className="stroke-muted-foreground"
              strokeDasharray="3 3"
              strokeWidth={1}
            />
            <circle
              cx={xs[shownIndex]}
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
        {hovered && hover !== null && (
          <TooltipBody
            title={
              timeAxis === "hours"
                ? clockOf(Date.parse(hovered.at))
                : formatDate(dayOf(hovered.at))
            }
            rows={[["Value", valueText(hovered.value)]]}
          />
        )}
      </ChartTooltip>
    </div>
  );
};
