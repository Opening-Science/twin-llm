"use client";

import { type PointerEvent, useMemo, useState } from "react";

import { extent, nearestIndex, niceTicks } from "@/infrastructure/charts/chart-geometry";
import { formatClock, formatNumber } from "@/infrastructure/format-measure";

const DAY_END = 23 * 60 + 59;
const TIME_TICKS = [0, 360, 720, 1080, DAY_END];
const x = (minute: number) => (minute / DAY_END) * 100;
const showValue = (value: number) => formatNumber(value, Number.isInteger(value) ? 0 : 1);

export type YourDayReading = Readonly<{ minute: number; value: number }>;

type Props = Readonly<{
  label: string;
  unit: string;
  readings: readonly YourDayReading[];
  initialMinute?: number;
  sample?: boolean;
}>;

export function YourDayChart({
  label,
  unit,
  readings,
  initialMinute = 0,
  sample = false,
}: Props) {
  const [pickedMinute, setPickedMinute] = useState<number | null>(null);
  const series = useMemo(() => {
    if (readings.length === 0) return null;
    const points = readings.toSorted((a, b) => a.minute - b.minute);
    const minutes = points.map((point) => point.minute);
    const [min, max] = extent(points.map((point) => point.value));
    const ticks = niceTicks(min, max, 2);
    const floor = ticks[0]!;
    const ceiling = ticks[ticks.length - 1]!;
    const y = (value: number) => ((ceiling - value) / (ceiling - floor)) * 100;
    const line = points.map(({ minute, value }) => `${x(minute)},${y(value)}`).join(" ");
    return { points, minutes, ticks, min, max, y, line };
  }, [readings]);
  const index = series ? nearestIndex(series.minutes, pickedMinute ?? initialMinute) : -1;
  const active = series?.points[index];

  const inspectPoint = (event: PointerEvent<HTMLDivElement>) => {
    const { left, width } = event.currentTarget.getBoundingClientRect();
    if (width > 0) setPickedMinute(((event.clientX - left) / width) * DAY_END);
  };

  return (
    <div className="dark surface text-foreground @container min-w-0 p-4 @sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 className="text-sm font-semibold">{label}</h4>
        {series && (
          <p className="text-muted-foreground text-xs tabular-nums">
            Daily range{" "}
            <span className="ml-1 whitespace-nowrap">
              {showValue(series.min)}–{showValue(series.max)} {unit}
            </span>
          </p>
        )}
      </div>
      {series && active ? (
        <>
          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="text-2xl leading-none font-semibold tabular-nums @sm:text-3xl">
              {showValue(active.value)}{" "}
              <span className="text-muted-foreground text-xs font-normal">{unit}</span>
            </p>
            <p className="text-muted-foreground text-xs tabular-nums">
              {sample ? "Sample data · " : null}
              {formatClock(active.minute)}
            </p>
          </div>
          <div className="focus-within:outline-ring relative mt-5 rounded-sm focus-within:outline-2 focus-within:outline-offset-4">
            {series.points.length > 1 && (
              <input
                type="range"
                className="sr-only"
                aria-label={`${label} time cursor`}
                aria-valuetext={`${formatClock(active.minute)}, ${showValue(active.value)} ${unit}`}
                min={0}
                max={series.points.length - 1}
                value={index}
                onChange={(event) =>
                  setPickedMinute(
                    series.points[event.currentTarget.valueAsNumber]!.minute,
                  )
                }
              />
            )}
            <div
              aria-hidden="true"
              className="text-muted-foreground ml-10 text-xs tabular-nums"
            >
              <div
                className="relative h-28 cursor-crosshair @sm:h-36"
                onPointerMove={(event) => {
                  if (event.pointerType === "mouse") inspectPoint(event);
                }}
                onPointerUp={inspectPoint}
              >
                {series.ticks.map((tick) => (
                  <span
                    key={tick}
                    className="pointer-events-none absolute -left-10 -translate-y-1/2"
                    style={{ top: `${series.y(tick)}%` }}
                  >
                    {showValue(tick)}
                  </span>
                ))}
                <svg
                  className="absolute inset-0 size-full overflow-visible"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                >
                  {series.ticks.map((tick) => (
                    <line
                      key={tick}
                      x1={0}
                      x2={100}
                      y1={series.y(tick)}
                      y2={series.y(tick)}
                      className="stroke-border"
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                  <polyline
                    points={series.line}
                    className="stroke-chart-3 fill-none"
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
                <div
                  className="border-muted-foreground pointer-events-none absolute inset-y-0 border-l border-dashed"
                  style={{ left: `${x(active.minute)}%` }}
                />
                <div
                  className="border-card bg-chart-3 pointer-events-none absolute size-3 -translate-1/2 rounded-full border-2"
                  style={{
                    left: `${x(active.minute)}%`,
                    top: `${series.y(active.value)}%`,
                  }}
                />
              </div>
              <div className="relative h-6 pt-2 text-[0.6875rem] @xs:text-xs">
                {TIME_TICKS.map((minute) => (
                  <span
                    key={minute}
                    className={
                      minute === 0
                        ? "absolute left-0"
                        : minute === DAY_END
                          ? "absolute right-0"
                          : minute === 720
                            ? "absolute -translate-x-1/2"
                            : "absolute -translate-x-1/2 @max-[14rem]:hidden"
                    }
                    style={
                      minute > 0 && minute < DAY_END
                        ? { left: `${x(minute)}%` }
                        : undefined
                    }
                  >
                    {formatClock(minute)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </>
      ) : (
        <p className="text-muted-foreground mt-3 text-xs">No readings for this day.</p>
      )}
    </div>
  );
}
