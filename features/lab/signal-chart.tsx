"use client";

import { useState } from "react";

import {
  ChartTooltip,
  TooltipBody,
  useMeasuredWidth,
} from "@/infrastructure/charts/chart-frame";
import {
  extent,
  labelIndexes,
  nearestIndex,
  niceTicks,
  tickDecimals,
} from "@/infrastructure/charts/chart-geometry";
import { formatNumber } from "@/infrastructure/format-measure";

import { type ChartPoint, type Span } from "./simulation-view";

/**
 * One simulated signal against seconds from the first beat: the RR
 * tachogram (interval per beat, with the windows the research flag marks as
 * shaded bands) or the pulse-wave proxy strip. A thin line in the first chart
 * colour, bands in the third, a crosshair and tooltip at the nearest point.
 * Draws at its measured width so axis text stays 11px on a phone.
 */

const PAD = { top: 22, right: 14, bottom: 28, left: 52 } as const;

export const SignalChart = ({
  points,
  durationSec,
  label,
  valueLabel,
  unit,
  decimals,
  spans = [],
  height = 240,
}: Readonly<{
  points: readonly ChartPoint[];
  durationSec: number;
  /** What the chart shows, for screen readers. */
  label: string;
  /** The tooltip's name for a value, e.g. "RR interval". */
  valueLabel: string;
  unit: string;
  decimals: number;
  spans?: readonly Span[];
  height?: number;
}>) => {
  const [ref, width] = useMeasuredWidth(640);
  const [hover, setHover] = useState<number | null>(null);
  if (points.length === 0) return null;

  const [minValue, maxValue] = extent(points.map((point) => point.value));
  const yTicks = niceTicks(minValue, maxValue);
  const low = yTicks[0]!;
  const high = yTicks.at(-1)!;
  const xTicksAll = niceTicks(0, durationSec, 6).filter((tick) => tick <= durationSec);
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const xOf = (t: number) => PAD.left + (t / durationSec) * plotW;
  const yOf = (value: number) => PAD.top + plotH * (1 - (value - low) / (high - low));
  const xs = points.map((point) => xOf(point.t));
  const path = points
    .map(
      (point, i) =>
        `${i === 0 ? "M" : "L"}${xs[i]!.toFixed(1)},${yOf(point.value).toFixed(1)}`,
    )
    .join(" ");
  const xTicks = labelIndexes(xTicksAll.length, Math.floor(plotW / 44)).map(
    (i) => xTicksAll[i]!,
  );
  const yText = tickDecimals(yTicks);
  const xText = tickDecimals(xTicksAll);
  const hovered = hover === null ? null : (points[hover] ?? null);

  return (
    <div ref={ref} className="relative w-full">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block h-auto w-full touch-pan-y"
        role="img"
        aria-label={label}
        onMouseLeave={() => setHover(null)}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setHover(nearestIndex(xs, ((event.clientX - rect.left) / rect.width) * width));
        }}
      >
        {spans.map((span) => (
          <rect
            key={`${span.start}-${span.end}`}
            x={xOf(span.start)}
            y={PAD.top}
            width={Math.max(1, xOf(span.end) - xOf(span.start))}
            height={plotH}
            className="text-chart-3 fill-current"
            fillOpacity={0.14}
          />
        ))}
        {yTicks.map((tick) => (
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
              {formatNumber(tick, yText)}
            </text>
          </g>
        ))}
        {unit === "" ? null : (
          <text
            x={PAD.left - 8}
            y={11}
            textAnchor="end"
            className="fill-muted-foreground font-mono text-[11px]"
          >
            {unit}
          </text>
        )}
        <path
          d={path}
          fill="none"
          className="text-chart-1"
          stroke="currentColor"
          strokeWidth={1.25}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {xTicks.map((tick) => (
          <text
            key={tick}
            x={xOf(tick)}
            y={height - 10}
            textAnchor={
              tick === 0 ? "start" : xOf(tick) > width - PAD.right - 24 ? "end" : "middle"
            }
            className="fill-muted-foreground font-mono text-[11px] tabular-nums"
          >
            {`${formatNumber(tick, xText)} s`}
          </text>
        ))}
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
              r={4}
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
            title={`${formatNumber(hovered.t, 2)} s`}
            rows={[
              [
                valueLabel,
                `${formatNumber(hovered.value, decimals)}${unit ? ` ${unit}` : ""}`,
              ],
              ...(spans.length > 0
                ? ([
                    [
                      "Research flag",
                      spans.some(
                        (span) => hovered.t > span.start && hovered.t <= span.end,
                      )
                        ? "Marked window"
                        : "Not marked",
                    ],
                  ] as const)
                : []),
            ]}
          />
        )}
      </ChartTooltip>
    </div>
  );
};
