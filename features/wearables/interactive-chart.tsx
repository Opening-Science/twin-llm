"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  formatDate,
  formatMeasure,
  formatNumber,
  type MeasureKind,
} from "@/infrastructure/format-measure";
import { type Size, tooltipPosition } from "@/infrastructure/chart-tooltip";
import { cn } from "@/infrastructure/ui";
import { Legend } from "@/infrastructure/ui-kit/legend";

export type ChartPoint = Readonly<{
  date: string;
  value: number;
}>;

export type ChartSeries = Readonly<{
  id: string;
  label: string;
  points: readonly ChartPoint[];
  /** Sets tooltip precision and unit; without it the tooltip shows one decimal. */
  kind?: MeasureKind;
  /** Overrides the series colour; defaults to the next `--chart-*` token. */
  className?: string;
}>;

/* Literal class names, so Tailwind's source scan sees every one of them.
   Series colours come from the categorical chart tokens, never `primary`,
   which is reserved for things you can operate. */
export const CHART_COLORS = [
  "text-chart-1",
  "text-chart-2",
  "text-chart-3",
  "text-chart-4",
  "text-chart-5",
] as const;

const seriesColor = (s: ChartSeries, index: number): string =>
  s.className ?? CHART_COLORS[index % CHART_COLORS.length]!;

type InteractiveChartProps = {
  readonly series: readonly ChartSeries[];
  readonly className?: string;
  readonly height?: number;
  /**
   * Fill the parent's height instead of keeping a fixed shape: the plot is
   * measured and drawn at its real size, so text and dots keep their size.
   * The parent must give the chart a height (a flex column, a grid cell).
   */
  readonly fill?: boolean;
};

/** The smallest plot a filling chart keeps, so a short card still reads. */
const FILL_MIN_HEIGHT = 140;

/**
 * Hoverable multi-series line chart from synced wearable points (real data).
 */
export const InteractiveChart = ({
  series,
  className,
  height = 180,
  fill = false,
}: InteractiveChartProps) => {
  const gradId = useId();
  const plotRef = useRef<HTMLDivElement>(null);
  const [plotSize, setPlotSize] = useState<Size | null>(null);
  const hasPoints = series.some((s) => s.points.length > 0);

  // Only a filling chart measures itself; it redraws on resize, not on hover.
  useEffect(() => {
    const el = plotRef.current;
    if (!fill || !el) return;
    const observer = new ResizeObserver(() => {
      const next = {
        width: Math.round(el.clientWidth),
        height: Math.round(el.clientHeight),
      };
      if (next.width === 0 || next.height === 0) return;
      setPlotSize((prev) =>
        prev && prev.width === next.width && prev.height === next.height ? prev : next,
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fill, hasPoints]);
  // x is in viewBox units; chart is the rendered size of the svg in CSS pixels.
  const [hover, setHover] = useState<{
    index: number;
    x: number;
    chart: Size;
  } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [tipSize, setTipSize] = useState<Size | null>(null);

  // Measure the tooltip after it renders, so it can be placed by its real size.
  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!el) return;
    const next = { width: el.offsetWidth, height: el.offsetHeight };
    setTipSize((prev) =>
      prev && prev.width === next.width && prev.height === next.height ? prev : next,
    );
  }, [hover]);

  const layout = useMemo(() => {
    const dates = [...new Set(series.flatMap((s) => s.points.map((p) => p.date)))].sort();
    if (dates.length === 0) return null;

    const values = series.flatMap((s) => s.points.map((p) => p.value));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(1, max - min);
    // 48 leaves room for a six-character tick ("10,635") at 10px mono,
    // about 6px a character, plus the 8px gap to the plot.
    const pad = { top: 16, right: 12, bottom: 28, left: 48 };
    const w = fill && plotSize ? plotSize.width : 640;
    const h = fill && plotSize ? plotSize.height : height;
    const innerW = w - pad.left - pad.right;
    const innerH = h - pad.top - pad.bottom;

    const xFor = (date: string) => {
      if (dates.length === 1) return pad.left + innerW / 2;
      const i = dates.indexOf(date);
      return pad.left + (i / (dates.length - 1)) * innerW;
    };
    const yFor = (value: number) => pad.top + innerH - ((value - min) / span) * innerH;

    const paths = series.map((s) => {
      const byDate = new Map(s.points.map((p) => [p.date, p.value]));
      const pts = dates
        .map((d) => {
          const v = byDate.get(d);
          if (v === undefined) return null;
          return { date: d, value: v, x: xFor(d), y: yFor(v) };
        })
        .filter(Boolean) as {
        date: string;
        value: number;
        x: number;
        y: number;
      }[];
      const d =
        pts.length === 0
          ? ""
          : pts
              .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
              .join(" ");
      return { ...s, pts, d };
    });

    return { dates, min, max, pad, w, h, innerW, innerH, xFor, yFor, paths };
  }, [series, height, fill, plotSize]);

  if (!layout || layout.dates.length < 1) {
    return (
      <p className="text-muted-foreground text-sm">Not enough points to chart yet.</p>
    );
  }

  const { dates, min, max, pad, w, h, paths, xFor, yFor } = layout;
  const hoverDate = hover ? dates[hover.index] : null;
  const hoverYs = paths.flatMap((s) =>
    s.pts.filter((p) => p.date === hoverDate).map((p) => p.y),
  );
  const scale = hover ? hover.chart.width / w : 1;
  const position =
    hover && tipSize && hoverYs.length > 0
      ? tooltipPosition(
          { x: hover.x * scale, y: Math.min(...hoverYs) * scale },
          hover.chart,
          tipSize,
        )
      : null;
  const seriesNames = paths.map((s) => s.label).join(" and ");

  return (
    <div className={cn("w-full", fill && "flex min-h-0 flex-1 flex-col", className)}>
      <div
        ref={plotRef}
        className={cn("relative", fill && "min-h-0 flex-1")}
        style={fill ? { minHeight: FILL_MIN_HEIGHT } : undefined}
      >
        <svg
          viewBox={`0 0 ${w} ${h}`}
          className={cn(
            "text-foreground w-full",
            fill ? "absolute inset-0 h-full" : "h-auto",
          )}
          role="img"
          aria-label={`Timeline of ${seriesNames}`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const x = ((event.clientX - rect.left) / rect.width) * w;
            let best = 0;
            let bestDist = Infinity;
            dates.forEach((d, i) => {
              const dx = Math.abs(xFor(d) - x);
              if (dx < bestDist) {
                bestDist = dx;
                best = i;
              }
            });
            setHover({
              index: best,
              x: xFor(dates[best]!),
              chart: { width: rect.width, height: rect.height },
            });
          }}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.12" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Y ticks */}
          {[min, (min + max) / 2, max].map((v) => (
            <g key={v}>
              <line
                x1={pad.left}
                x2={w - pad.right}
                y1={yFor(v)}
                y2={yFor(v)}
                className="stroke-border"
                strokeWidth="1"
              />
              <text
                x={pad.left - 8}
                y={yFor(v) + 3}
                textAnchor="end"
                className="fill-muted-foreground font-mono text-[10px]"
              >
                {formatNumber(v, 0)}
              </text>
            </g>
          ))}

          {paths.map((s, si) => (
            <g key={s.id} className={seriesColor(s, si)}>
              <path d={s.d} fill="none" stroke="currentColor" strokeWidth="2" />
              {s.pts.map((p) => (
                <circle
                  key={`${s.id}-${p.date}`}
                  cx={p.x}
                  cy={p.y}
                  r={hoverDate === p.date ? 4 : 2.5}
                  fill="currentColor"
                />
              ))}
            </g>
          ))}

          {hover && hoverDate && (
            <line
              x1={hover.x}
              x2={hover.x}
              y1={pad.top}
              y2={h - pad.bottom}
              className="stroke-muted-foreground/50"
              strokeDasharray="3 3"
            />
          )}

          {/* X labels: first, mid, last */}
          {[0, Math.floor((dates.length - 1) / 2), dates.length - 1]
            .filter((i, n, arr) => arr.indexOf(i) === n)
            .map((i) => (
              <text
                key={dates[i]}
                x={xFor(dates[i]!)}
                y={h - 8}
                // Edge labels hug the plot so "16 Oct" is not clipped by the frame.
                textAnchor={
                  dates.length === 1
                    ? "middle"
                    : i === 0
                      ? "start"
                      : i === dates.length - 1
                        ? "end"
                        : "middle"
                }
                className="fill-muted-foreground font-mono text-[10px]"
              >
                {formatDate(dates[i], "short")}
              </text>
            ))}
        </svg>

        {hoverDate && hover && (
          <div
            ref={tipRef}
            className="border-border bg-card pointer-events-none absolute top-0 left-0 w-max rounded-lg border px-3 py-2 text-xs shadow-sm"
            style={{
              maxWidth: hover.chart.width,
              // Hidden for the one frame before its size is known.
              visibility: position ? "visible" : "hidden",
              transform: position
                ? `translate(${position.left}px, ${position.top}px)`
                : undefined,
            }}
          >
            <p className="font-mono font-normal">{formatDate(hoverDate)}</p>
            <ul className="mt-1 space-y-0.5">
              {paths.map((s) => {
                const hit = s.pts.find((p) => p.date === hoverDate);
                return (
                  <li key={s.id} className="text-muted-foreground flex gap-2">
                    <span>{s.label}</span>
                    <span className="text-foreground font-mono">
                      {s.kind
                        ? formatMeasure(s.kind, hit?.value)
                        : formatNumber(hit?.value, 1)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      <Legend
        className="mt-2"
        items={paths.map((s, si) => ({
          id: s.id,
          label: s.label,
          swatchClassName: seriesColor(s, si),
        }))}
      />
    </div>
  );
};
