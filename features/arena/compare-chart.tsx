"use client";

import { type CompareSpec, type ViewPoint, windowText } from "@/infrastructure/chat-view";
import { formatNumber } from "@/infrastructure/format-measure";

import { useMeasuredWidth } from "@/infrastructure/charts/chart-frame";
import {
  dateAxisTicks,
  extent,
  niceTicks,
  tickDecimals,
  timeScale,
} from "@/infrastructure/charts/chart-geometry";

import { windowBounds } from "./view-chart";
import { compareDeltaText, compareWindowText, MEAN_DECIMALS } from "./view-text";

/**
 * `chart.compare`: the earlier window (`compare_with`) and the window asked
 * about, on one value axis. Side by side, each panel has its own dates;
 * overlaid, both run from day 1 of their window. The earlier window is a grey
 * dashed line and the later one the chart colour; each has its n and mean in
 * words, so nothing depends on telling the colours apart.
 */

const PAD = { top: 10, right: 12, bottom: 24, left: 52 } as const;
const GAP = 20;
const DAY_MS = 86_400_000;

type Series = Readonly<{
  points: readonly ViewPoint[];
  mean: number | null;
  /** x of a reading's time, in pixels. */
  xOf: (time: number) => number;
  className: string;
  dashed: boolean;
}>;

const SeriesMarks = ({
  series,
  yOf,
  x0,
  x1,
}: Readonly<{
  series: Series;
  yOf: (value: number) => number;
  x0: number;
  x1: number;
}>) => {
  const xs = series.points.map((point) => series.xOf(Date.parse(point.at)));
  const path = xs
    .map(
      (x, i) =>
        `${i === 0 ? "M" : "L"}${x.toFixed(1)},${yOf(series.points[i]!.value).toFixed(1)}`,
    )
    .join(" ");
  return (
    <g className={series.className}>
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeDasharray={series.dashed ? "4 3" : undefined}
        strokeLinejoin="round"
      />
      {series.points.length <= 80 &&
        series.points.map((point, i) => (
          <circle
            key={`${point.at}-${i}`}
            cx={xs[i]}
            cy={yOf(point.value)}
            r={2.5}
            fill={series.dashed ? "var(--card)" : "currentColor"}
            stroke="currentColor"
            strokeWidth={1.2}
          />
        ))}
      {series.mean !== null && (
        <line
          x1={x0}
          x2={x1}
          y1={yOf(series.mean)}
          y2={yOf(series.mean)}
          stroke="currentColor"
          strokeOpacity={0.7}
          strokeDasharray="1 3"
          strokeWidth={1.5}
        />
      )}
    </g>
  );
};

const BEFORE_CLASS = "text-muted-foreground";
const AFTER_CLASS = "text-chart-1";

const Legend = ({
  spec,
  decimals,
}: Readonly<{ spec: CompareSpec; decimals: number }>) => (
  <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
    {(
      [
        ["Earlier", spec.before, BEFORE_CLASS, "4 3"],
        ["Later", spec.after, AFTER_CLASS, undefined],
      ] as const
    ).map(([name, window, className, dash]) => (
      <div key={name} className="flex items-baseline gap-2">
        <svg width={18} height={8} aria-hidden="true" className={`${className} shrink-0`}>
          <line
            x1={0}
            x2={18}
            y1={4}
            y2={4}
            stroke="currentColor"
            strokeWidth={1.5}
            strokeDasharray={dash}
          />
        </svg>
        <dt className="font-medium">
          {name} · {windowText(window)}
        </dt>
        <dd className="text-muted-foreground font-mono tabular-nums">
          {compareWindowText(window, spec.unit, decimals)}
        </dd>
      </div>
    ))}
  </dl>
);

export const CompareChart = ({
  spec,
  label,
  height = 200,
}: Readonly<{ spec: CompareSpec; label: string; height?: number }>) => {
  const [ref, width] = useMeasuredWidth(640);
  const values = [...spec.before.points, ...spec.after.points].map(
    (point) => point.value,
  );
  const decimals = MEAN_DECIMALS;
  const delta = compareDeltaText(spec, decimals);
  if (values.length === 0) {
    return <p className="text-muted-foreground text-sm">No readings in either window.</p>;
  }
  const means = [spec.before.mean, spec.after.mean].filter(
    (mean): mean is number => mean !== null,
  );
  const [low, high] = extent([...values, ...means]);
  const ticks = niceTicks(low, high);
  const top = ticks.at(-1)!;
  const bottom = ticks[0]!;
  const plotH = height - PAD.top - PAD.bottom;
  const yOf = (value: number) =>
    PAD.top + plotH * (1 - (value - bottom) / (top - bottom));
  const plotW = width - PAD.left - PAD.right;
  const tickText = tickDecimals(ticks);

  const panel = (window: CompareSpec["before"], left: number, panelW: number) => {
    const [start, end] = windowBounds(window);
    return { start, end, left, panelW, xOf: timeScale(start, end, left, panelW) };
  };

  const sideBySide = spec.layout === "side-by-side";
  const panelW = sideBySide ? (plotW - GAP) / 2 : plotW;
  const before = panel(spec.before, PAD.left, panelW);
  const after = panel(
    spec.after,
    sideBySide ? PAD.left + panelW + GAP : PAD.left,
    panelW,
  );
  const span = Math.max(before.end - before.start, after.end - after.start);
  // Overlaid: both windows from their own first day, on one axis of days.
  const dayX = (offset: number) =>
    PAD.left + (span === 0 ? plotW / 2 : (offset / span) * plotW);
  const series: readonly Series[] = [
    {
      points: spec.before.points,
      mean: spec.before.mean,
      xOf: sideBySide ? before.xOf : (time) => dayX(time - before.start),
      className: BEFORE_CLASS,
      dashed: true,
    },
    {
      points: spec.after.points,
      mean: spec.after.mean,
      xOf: sideBySide ? after.xOf : (time) => dayX(time - after.start),
      className: AFTER_CLASS,
      dashed: false,
    },
  ];
  const ranges = sideBySide
    ? [before, after].map((p) => [p.left, p.left + p.panelW] as const)
    : [[PAD.left, PAD.left + plotW] as const, [PAD.left, PAD.left + plotW] as const];
  const xLabels = sideBySide
    ? [before, after].flatMap((p) => {
        const ticksOf = dateAxisTicks(p.start, p.end);
        const shown = ticksOf.filter(
          (_, i) => i % Math.max(1, Math.ceil(ticksOf.length / 3)) === 0,
        );
        return shown.map((tick) => ({ x: p.xOf(tick.time), text: tick.label }));
      })
    : Array.from({ length: 5 }, (_, i) => {
        const days = Math.round(((span / DAY_MS) * i) / 4);
        return { x: dayX(days * DAY_MS), text: `day ${days + 1}` };
      });

  return (
    <div className="flex flex-col gap-2">
      <Legend spec={spec} decimals={decimals} />
      <div ref={ref} className="w-full">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block h-auto w-full"
          role="img"
          aria-label={`${label}. Earlier: ${compareWindowText(spec.before, spec.unit, decimals)}. Later: ${compareWindowText(spec.after, spec.unit, decimals)}.`}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              {ranges.slice(0, sideBySide ? 2 : 1).map(([x0, x1]) => (
                <line
                  key={x0}
                  x1={x0}
                  x2={x1}
                  y1={yOf(tick)}
                  y2={yOf(tick)}
                  className="stroke-border"
                  strokeWidth={1}
                />
              ))}
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
          {series.map((one, i) => (
            <SeriesMarks
              key={one.className}
              series={one}
              yOf={yOf}
              x0={ranges[i]![0]}
              x1={ranges[i]![1]}
            />
          ))}
          {xLabels.map((tick) => (
            <text
              key={`${tick.x}-${tick.text}`}
              x={tick.x}
              y={height - 6}
              textAnchor="middle"
              className="fill-muted-foreground font-mono text-[11px]"
            >
              {tick.text}
            </text>
          ))}
        </svg>
      </div>
      {delta !== null && <p className="text-sm">{delta}</p>}
      <p className="text-muted-foreground text-xs">
        Dotted lines mark each window&apos;s mean.
      </p>
    </div>
  );
};
