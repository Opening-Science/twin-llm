"use client";

import { useState } from "react";

import {
  ChartTooltip,
  TooltipBody,
  useMeasuredWidth,
} from "@/infrastructure/charts/chart-frame";
import { truncateLabel } from "@/infrastructure/charts/chart-geometry";

/**
 * Horizontal bars, one series: a label, a thin bar with round ends, and the
 * value written beside it, so the number is readable without hovering. Hover
 * adds the detail rows. The bar colour is the first chart token; every word
 * stays in a text colour.
 */

export type BarItem = Readonly<{
  id: string;
  label: string;
  /** Bar length as a fraction of the longest possible bar, 0..1. */
  fraction: number;
  valueText: string;
  detail: readonly (readonly [string, string])[];
}>;

const ROW = 28;
const BAR = 8;
const VALUE_SPACE = 52;

export const BarList = ({
  items,
  label,
}: {
  readonly items: readonly BarItem[];
  readonly label: string;
}) => {
  const [ref, width] = useMeasuredWidth(640);
  const [hover, setHover] = useState<number | null>(null);
  if (items.length === 0) return null;

  const labelWidth = Math.min(260, Math.round(width * 0.42));
  const plotStart = labelWidth + 8;
  const plotWidth = Math.max(20, width - plotStart - VALUE_SPACE);
  const maxChars = Math.max(8, Math.floor(labelWidth / 6.6));
  const height = items.length * ROW;
  const hovered = hover === null ? null : items[hover];

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
          const y = ((event.clientY - rect.top) / rect.height) * height;
          setHover(Math.min(items.length - 1, Math.max(0, Math.floor(y / ROW))));
        }}
      >
        {items.map((item, index) => {
          const y = index * ROW;
          const barWidth = Math.max(BAR, item.fraction * plotWidth);
          return (
            <g key={item.id}>
              {hover === index && (
                <rect
                  x={0}
                  y={y}
                  width={width}
                  height={ROW}
                  rx={6}
                  className="fill-muted"
                />
              )}
              <text
                x={labelWidth}
                y={y + ROW / 2 + 4}
                textAnchor="end"
                className="fill-foreground text-[12px]"
              >
                {truncateLabel(item.label, maxChars)}
              </text>
              <rect
                x={plotStart}
                y={y + (ROW - BAR) / 2}
                width={barWidth}
                height={BAR}
                rx={BAR / 2}
                className="text-chart-1 fill-current"
              />
              <text
                x={plotStart + barWidth + 6}
                y={y + ROW / 2 + 4}
                className="fill-muted-foreground font-mono text-[11px] tabular-nums"
              >
                {item.valueText}
              </text>
            </g>
          );
        })}
      </svg>
      <ChartTooltip
        anchor={
          hover === null
            ? null
            : {
                x: plotStart + Math.max(BAR, items[hover]!.fraction * plotWidth),
                y: hover * ROW + ROW / 2,
              }
        }
        chart={{ width, height }}
      >
        {hovered && <TooltipBody title={hovered.label} rows={hovered.detail} />}
      </ChartTooltip>
    </div>
  );
};
