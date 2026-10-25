"use client";

import { useState } from "react";

import { formatNumber } from "@/infrastructure/format-measure";

import { ChartTooltip, TooltipBody, useMeasuredWidth } from "./chart-frame";
import { countTicks, labelIndexes, nearestIndex } from "./chart-geometry";

/**
 * Vertical bars for counts: one y axis from zero with round ticks, columns
 * with rounded tops, a few x labels that never collide, and a tooltip for the
 * column under the pointer. One series, so no legend.
 */

export type Column = Readonly<{
  id: string;
  label: string;
  value: number;
  detail: readonly (readonly [string, string])[];
}>;

const PAD = { top: 12, right: 8, bottom: 26, left: 48 } as const;

/** A column with its top corners rounded and a flat foot on the axis. */
const columnPath = (x: number, y: number, w: number, h: number): string => {
  const r = Math.min(3, w / 2, h);
  return [
    `M${x},${y + h}`,
    `V${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `H${x + w - r}`,
    `Q${x + w},${y} ${x + w},${y + r}`,
    `V${y + h}`,
    "Z",
  ].join(" ");
};

export const ColumnChart = ({
  columns,
  label,
  height = 200,
}: {
  readonly columns: readonly Column[];
  readonly label: string;
  readonly height?: number;
}) => {
  const [ref, width] = useMeasuredWidth(640);
  const [hover, setHover] = useState<number | null>(null);
  if (columns.length === 0) return null;

  const ticks = countTicks(Math.max(...columns.map((column) => column.value)));
  const top = ticks[ticks.length - 1]!;
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const slot = plotW / columns.length;
  const gap = slot > 6 ? Math.min(6, slot * 0.25) : 0;
  const barW = Math.max(1, slot - gap);
  const xOf = (index: number) => PAD.left + index * slot + gap / 2;
  const yOf = (value: number) => PAD.top + plotH * (1 - value / top);
  const centres = columns.map((_, index) => xOf(index) + barW / 2);
  const labels = labelIndexes(columns.length, Math.floor(plotW / 56));
  const hovered = hover === null ? null : columns[hover];

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
          setHover(nearestIndex(centres, x));
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
              {formatNumber(tick, 0)}
            </text>
          </g>
        ))}
        {columns.map((column, index) =>
          column.value > 0 ? (
            <path
              key={column.id}
              d={columnPath(
                xOf(index),
                yOf(column.value),
                barW,
                yOf(0) - yOf(column.value),
              )}
              className="text-chart-1 fill-current"
              opacity={hover === null || hover === index ? 1 : 0.5}
            />
          ) : null,
        )}
        {labels.map((index) => (
          <text
            key={columns[index]!.id}
            x={centres[index]}
            y={height - 8}
            textAnchor={
              index === 0 ? "start" : index === columns.length - 1 ? "end" : "middle"
            }
            className="fill-muted-foreground font-mono text-[11px]"
          >
            {columns[index]!.label}
          </text>
        ))}
      </svg>
      <ChartTooltip
        anchor={
          hover === null
            ? null
            : { x: centres[hover]!, y: yOf(Math.max(0, columns[hover]!.value)) }
        }
        chart={{ width, height }}
      >
        {hovered && <TooltipBody title={hovered.label} rows={hovered.detail} />}
      </ChartTooltip>
    </div>
  );
};
