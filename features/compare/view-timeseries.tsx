"use client";

import { useMeasuredWidth } from "@/infrastructure/charts/chart-frame";
import {
  dateAxisTicks,
  extent,
  niceTicks,
  tickDecimals,
  timeScale,
} from "@/infrastructure/charts/chart-geometry";
import type { TimeseriesSpec, ViewPoint } from "@/infrastructure/chat-view";
import { formatNumber } from "@/infrastructure/format-measure";

import {
  dayOf,
  NO_READINGS_IN_WINDOW,
  pointTime,
  seriesDecimals,
  seriesDomain,
  valueWithUnit,
} from "./view-text";

/**
 * A time series in an answer (SPEC 5.5): every reading at its own time over
 * the view's window, as a line with a dot per reading. Drawn at the
 * container's real width so axis text stays readable on a phone.
 */

const HEIGHT = 180;
const PAD = { top: 10, right: 12, bottom: 24, left: 44 } as const;

export type PlotSeries = Readonly<{
  points: readonly ViewPoint[];
  /** x of a point, in ms; defaults to its own time. */
  timeOf?: (point: ViewPoint) => number;
  /** The earlier window of a comparison: grey and dashed. */
  earlier?: boolean;
  mean?: number | null;
}>;

type PlotProps = Readonly<{
  series: readonly PlotSeries[];
  domain: readonly [number, number];
  /** Shared value axis across panels; computed from the series when absent. */
  valueTicks?: readonly number[];
  /** Tick labels on the time axis. */
  timeTicks?: readonly Readonly<{ time: number; label: string }>[];
  decimals: number;
  height?: number;
}>;

/** The value axis every panel of one chart shares. */
export const valueAxis = (values: readonly number[]): readonly number[] => {
  if (values.length === 0) return niceTicks(0, 1);
  const [low, high] = extent(values);
  return niceTicks(low, high);
};

/** One SVG line plot; decorative, the caption and words beside it carry the meaning. */
export const LinePlot = ({
  series,
  domain,
  valueTicks,
  timeTicks,
  decimals,
  height = HEIGHT,
}: PlotProps) => {
  const [ref, width] = useMeasuredWidth(520);
  const ticks =
    valueTicks ??
    valueAxis(series.flatMap((each) => each.points.map((point) => point.value)));
  const low = ticks[0] ?? 0;
  const high = ticks[ticks.length - 1] ?? 1;
  const plotWidth = Math.max(1, width - PAD.left - PAD.right);
  const plotHeight = height - PAD.top - PAD.bottom;
  const x = timeScale(domain[0], domain[1], PAD.left, plotWidth);
  const y = (value: number): number =>
    PAD.top + plotHeight - ((value - low) / (high - low || 1)) * plotHeight;
  const tickLabels = timeTicks ?? dateAxisTicks(domain[0], domain[1]);
  const labelDecimals = Math.max(tickDecimals(ticks), 0);
  return (
    <div ref={ref} className="w-full">
      <svg
        width={width}
        height={height}
        className="block w-full"
        aria-hidden="true"
        focusable="false"
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={PAD.left + plotWidth}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--border)"
            />
            <text
              x={PAD.left - 6}
              y={y(tick)}
              dy="0.32em"
              textAnchor="end"
              className="fill-muted-foreground font-mono text-[11px]"
            >
              {formatNumber(
                tick,
                decimals === 0 ? labelDecimals : Math.max(labelDecimals, 0),
              )}
            </text>
          </g>
        ))}
        {tickLabels.map((tick) => (
          <text
            key={tick.time}
            x={x(tick.time)}
            y={height - 6}
            textAnchor="middle"
            className="fill-muted-foreground text-[11px]"
          >
            {tick.label}
          </text>
        ))}
        {series.map((each, index) => {
          const timeOf = each.timeOf ?? pointTime;
          const stroke = each.earlier === true ? "var(--chart-5)" : "var(--chart-1)";
          const path = each.points
            .map(
              (point, at) =>
                `${at === 0 ? "M" : "L"}${x(timeOf(point)).toFixed(1)},${y(point.value).toFixed(1)}`,
            )
            .join(" ");
          return (
            <g key={index}>
              {each.mean !== undefined && each.mean !== null ? (
                <line
                  x1={PAD.left}
                  x2={PAD.left + plotWidth}
                  y1={y(each.mean)}
                  y2={y(each.mean)}
                  stroke={stroke}
                  strokeWidth={1}
                  strokeDasharray="2 3"
                  opacity={0.8}
                />
              ) : null}
              <path
                d={path}
                fill="none"
                stroke={stroke}
                strokeWidth={1.75}
                strokeDasharray={each.earlier === true ? "5 4" : undefined}
              />
              {each.points.length <= 120
                ? each.points.map((point) => (
                    <circle
                      key={`${point.at}-${point.value}`}
                      cx={x(timeOf(point))}
                      cy={y(point.value)}
                      r={2.25}
                      fill={stroke}
                    />
                  ))
                : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
};

/** The readings in words, for screen readers: first and last, lowest and highest. */
const seriesSummary = (spec: TimeseriesSpec, decimals: number): string => {
  const values = spec.points.map((point) => point.value);
  const [low, high] = extent(values);
  const first = spec.points[0];
  const last = spec.points[spec.points.length - 1];
  const value = (n: number) => valueWithUnit(n, spec.unit, decimals, spec.label);
  return [
    `${String(spec.points.length)} ${spec.points.length === 1 ? "reading" : "readings"}`,
    first === undefined ? "" : `from ${dayOf(first.at)} (${value(first.value)})`,
    last === undefined || last === first
      ? ""
      : `to ${dayOf(last.at)} (${value(last.value)})`,
    spec.points.length > 1 ? `lowest ${value(low)}, highest ${value(high)}` : "",
  ]
    .filter((part) => part !== "")
    .join(", ");
};

export const TimeseriesView = ({ spec }: Readonly<{ spec: TimeseriesSpec }>) => {
  if (spec.points.length === 0) {
    return <p className="text-muted-foreground text-sm">{NO_READINGS_IN_WINDOW}</p>;
  }
  const decimals = seriesDecimals(spec.points.map((point) => point.value));
  return (
    <>
      <LinePlot
        series={[{ points: spec.points }]}
        domain={seriesDomain(spec.points, spec.window)}
        decimals={decimals}
      />
      <p className="sr-only">{seriesSummary(spec, decimals)}.</p>
    </>
  );
};
