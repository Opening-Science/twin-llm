"use client";

import { useState } from "react";

import { formatNumber } from "@/infrastructure/format-measure";

import {
  ChartTooltip,
  TooltipBody,
  useMeasuredWidth,
} from "@/infrastructure/charts/chart-frame";
import {
  countTicks,
  nearestIndex,
  stepPath,
} from "@/infrastructure/charts/chart-geometry";
import {
  type CodeSummary,
  formatShare,
  SPARSE_SHARE,
  unitLabel,
  WIDE_SHARE,
} from "./cohort-stats";

/**
 * Every LOINC code of a cohort, most widespread first (x: rank), by the share
 * of subjects with at least one reading (y, 0 to 100%). One thin stepped line,
 * so a flat top (codes everybody has) and the long tail (codes few have) are
 * both visible, which a top-20 bar list at 100% was not. Dashed hairlines mark
 * the 80% and 10% thresholds the code lists below the chart use. Hover gives
 * the code under the pointer; the table under the chart lists every code.
 */

const PAD = { top: 12, right: 12, bottom: 26, left: 48 } as const;
const Y_TICKS = [0, 0.25, 0.5, 0.75, 1] as const;

export const CoverageCurve = ({
  codes,
  subjects,
  label,
  height = 220,
}: {
  /** Sorted widest first, as `summariseCodes` returns them. */
  readonly codes: readonly CodeSummary[];
  readonly subjects: number;
  readonly label: string;
  readonly height?: number;
}) => {
  const [ref, width] = useMeasuredWidth(640);
  const [hover, setHover] = useState<number | null>(null);
  if (codes.length === 0) return null;

  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const slot = plotW / codes.length;
  const yOf = (share: number) => PAD.top + plotH * (1 - share);
  const centres = codes.map((_, index) => PAD.left + (index + 0.5) * slot);
  const path = stepPath(
    codes.map((code) => yOf(code.share)),
    PAD.left,
    slot,
  );
  // Round ranks (1, 20, 40, …) rather than every n-th code, so the axis reads as a count.
  const rankStep = countTicks(codes.length, Math.max(2, Math.floor(plotW / 56)))[1]!;
  const labels = [
    0,
    ...Array.from(
      { length: Math.floor(codes.length / rankStep) },
      (_, i) => (i + 1) * rankStep - 1,
    ).filter((index) => index > 0),
  ];
  const hovered = hover === null ? null : codes[hover];
  const thresholds = [WIDE_SHARE, SPARSE_SHARE] as const;

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
          setHover(
            nearestIndex(centres, ((event.clientX - rect.left) / rect.width) * width),
          );
        }}
      >
        {Y_TICKS.map((tick) => (
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
              {formatShare(tick)}
            </text>
          </g>
        ))}
        {thresholds.map((share) => (
          <g key={share}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={yOf(share)}
              y2={yOf(share)}
              className="stroke-muted-foreground"
              strokeDasharray="2 4"
              strokeWidth={1}
            />
            {/* Left, under the curve's flat top, where the line never runs. */}
            <text
              x={PAD.left + 4}
              y={yOf(share) + 13}
              textAnchor="start"
              className="fill-muted-foreground font-mono text-[11px] tabular-nums"
            >
              {formatShare(share)}
            </text>
          </g>
        ))}
        <path
          d={path}
          fill="none"
          className="text-chart-1"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {labels.map((index) => (
          <text
            key={codes[index]!.loinc}
            x={centres[index]}
            y={height - 8}
            textAnchor={
              index === 0 ? "start" : index === codes.length - 1 ? "end" : "middle"
            }
            className="fill-muted-foreground font-mono text-[11px] tabular-nums"
          >
            {formatNumber(index + 1, 0)}
          </text>
        ))}
        {hovered && hover !== null && (
          <g>
            <line
              x1={centres[hover]}
              x2={centres[hover]}
              y1={PAD.top}
              y2={height - PAD.bottom}
              className="stroke-muted-foreground"
              strokeDasharray="3 3"
              strokeWidth={1}
            />
            <circle
              cx={centres[hover]}
              cy={yOf(hovered.share)}
              r={4.5}
              className="text-chart-1 stroke-card fill-current"
              strokeWidth={2}
            />
          </g>
        )}
      </svg>
      <ChartTooltip
        anchor={
          hovered && hover !== null ? { x: centres[hover]!, y: yOf(hovered.share) } : null
        }
        chart={{ width, height }}
      >
        {hovered && hover !== null && (
          <TooltipBody
            title={hovered.display}
            rows={[
              ["LOINC", hovered.loinc],
              ["Unit", unitLabel(hovered.units)],
              [
                "Subjects",
                `${formatNumber(hovered.subjects, 0)} of ${formatNumber(subjects, 0)} (${formatShare(hovered.share)})`,
              ],
              ["Readings", formatNumber(hovered.rows, 0)],
              [
                "Rank",
                `${formatNumber(hover + 1, 0)} of ${formatNumber(codes.length, 0)}`,
              ],
            ]}
          />
        )}
      </ChartTooltip>
    </div>
  );
};
