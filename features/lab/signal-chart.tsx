"use client";

import { useState } from "react";

import {
  ChartTooltip,
  TooltipBody,
  useMeasuredWidth,
} from "@/infrastructure/charts/chart-frame";
import { nearestIndex } from "@/infrastructure/charts/chart-geometry";
import { categoryTextClass } from "@/infrastructure/charts/category-token";
import { formatNumber } from "@/infrastructure/format-measure";

import { signalLayout } from "./signal-geometry";
import { type ChartPoint, type Span } from "./simulation-view";

/**
 * One simulated signal against seconds from the first beat: the RR
 * tachogram (interval per beat, with the windows the research flag marks as
 * bands in the chart-band tint) or the pulse-wave proxy strip. Drawn as the chart
 * kit draws: the line in the heart category's colour, no gridlines and no Y
 * axis; the highest and lowest value are grey rules with MAX and MIN written
 * beside them, and seconds stay as axis words. A crosshair and tooltip follow
 * the nearest point. Draws at its measured width so axis text keeps its size
 * on a phone. The layout is `signal-geometry.ts`.
 */

const AXIS_TEXT = "fill-muted-foreground font-mono text-axis font-normal tabular-nums";
const LINE_CLASS = categoryTextClass("heart");

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

  const layout = signalLayout(points, durationSec, spans, { width, height });
  const { plot, xs, ys } = layout;
  const withUnit = (value: number) =>
    `${formatNumber(value, decimals)}${unit ? ` ${unit}` : ""}`;
  const hovered = hover === null ? null : (points[hover] ?? null);
  const right = plot.left + plot.width;

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
        {layout.bands.map((band) => (
          <rect
            key={`${band.x}-${band.width}`}
            x={band.x}
            y={plot.top}
            width={band.width}
            height={plot.height}
            rx={4}
            className="fill-chart-band"
          />
        ))}
        {[
          { word: "MAX", rule: layout.max, textY: layout.max.y - 8 },
          { word: "MIN", rule: layout.min, textY: layout.min.y + 16 },
        ].map(({ word, rule, textY }) => (
          <g key={word}>
            <line
              x1={plot.left}
              x2={right}
              y1={rule.y}
              y2={rule.y}
              className="stroke-chart-reference"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <text x={plot.left} y={textY} className={AXIS_TEXT}>
              {`${word} ${withUnit(rule.value)}`}
            </text>
          </g>
        ))}
        <path
          d={layout.path}
          fill="none"
          className={LINE_CLASS}
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {layout.ticks.map((tick) => (
          <text
            key={tick.t}
            x={tick.x}
            y={height - 6}
            textAnchor={tick.anchor}
            className={AXIS_TEXT}
          >
            {`${formatNumber(tick.t, layout.tickDecimals)} s`}
          </text>
        ))}
        {hovered && hover !== null && (
          <g>
            <line
              x1={xs[hover]}
              x2={xs[hover]}
              y1={plot.top}
              y2={plot.top + plot.height}
              className="stroke-chart-reference"
              strokeDasharray="3 3"
              strokeWidth={1}
            />
            <circle
              cx={xs[hover]}
              cy={ys[hover]}
              r={4}
              className={`${LINE_CLASS} stroke-card fill-current`}
              strokeWidth={2}
            />
          </g>
        )}
      </svg>
      <ChartTooltip
        anchor={hovered && hover !== null ? { x: xs[hover]!, y: ys[hover]! } : null}
        chart={{ width, height }}
      >
        {hovered && (
          <TooltipBody
            title={`${formatNumber(hovered.t, 2)} s`}
            rows={[
              [valueLabel, withUnit(hovered.value)],
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
