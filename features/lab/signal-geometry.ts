import {
  extent,
  labelIndexes,
  niceTicks,
  tickDecimals,
} from "@/infrastructure/charts/chart-geometry";

import { type ChartPoint, type Span } from "./simulation-view";

/**
 * Where a Lab signal chart (RR tachogram, pulse strip) draws, in the chart
 * kit's manner: no gridlines and no Y axis; the highest and lowest value are
 * grey rules with MAX and MIN written beside them, and seconds stay as axis
 * words along the bottom. Pure, so the layout is tested without a browser.
 */

export const SIGNAL_PAD = { top: 26, right: 8, bottom: 44, left: 8 } as const;

export type SignalTick = Readonly<{
  t: number;
  x: number;
  anchor: "start" | "middle" | "end";
}>;

export type SignalLayout = Readonly<{
  plot: Readonly<{ left: number; top: number; width: number; height: number }>;
  /** Screen x and y of each point, in order. */
  xs: readonly number[];
  ys: readonly number[];
  path: string;
  /** The highest and lowest value with the y of their rule. */
  max: Readonly<{ value: number; y: number }>;
  min: Readonly<{ value: number; y: number }>;
  bands: readonly Readonly<{ x: number; width: number }>[];
  ticks: readonly SignalTick[];
  /** Decimals for the seconds on the axis. */
  tickDecimals: number;
}>;

export const signalLayout = (
  points: readonly ChartPoint[],
  durationSec: number,
  spans: readonly Span[],
  box: Readonly<{ width: number; height: number }>,
): SignalLayout => {
  const plot = {
    left: SIGNAL_PAD.left,
    top: SIGNAL_PAD.top,
    width: Math.max(1, box.width - SIGNAL_PAD.left - SIGNAL_PAD.right),
    height: Math.max(1, box.height - SIGNAL_PAD.top - SIGNAL_PAD.bottom),
  };
  const [low, high] = points.length === 0 ? [0, 1] : extent(points.map((p) => p.value));
  const span = high - low;
  const duration = durationSec > 0 ? durationSec : 1;
  const xOf = (t: number): number => plot.left + (t / duration) * plot.width;
  // A flat signal sits in the middle rather than on an edge.
  const yOf = (value: number): number =>
    span === 0
      ? plot.top + plot.height / 2
      : plot.top + plot.height * (1 - (value - low) / span);
  const xs = points.map((p) => xOf(p.t));
  const ys = points.map((p) => yOf(p.value));
  const path = points
    .map((_, i) => `${i === 0 ? "M" : "L"}${xs[i]!.toFixed(1)},${ys[i]!.toFixed(1)}`)
    .join(" ");
  const all = niceTicks(0, duration, 6).filter((t) => t <= duration);
  const right = plot.left + plot.width;
  const ticks = labelIndexes(all.length, Math.floor(plot.width / 44)).map((i) => {
    const t = all[i]!;
    const x = xOf(t);
    return {
      t,
      x,
      anchor: t === 0 ? "start" : x > right - 24 ? "end" : "middle",
    } as const;
  });
  return {
    plot,
    xs,
    ys,
    path,
    max: { value: high, y: yOf(high) },
    min: { value: low, y: yOf(low) },
    bands: spans.map((s) => ({
      x: xOf(s.start),
      width: Math.max(1, xOf(s.end) - xOf(s.start)),
    })),
    ticks,
    tickDecimals: tickDecimals(all),
  };
};
