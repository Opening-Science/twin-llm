"use client";

import { X } from "lucide-react";
import { useId, useMemo } from "react";

import { countTicks, extent, niceTicks } from "@/infrastructure/charts/chart-geometry";
import { formatNumber } from "@/infrastructure/format-measure";
import {
  chartSeries,
  readingInSeriesAt,
  seriesOf,
} from "@/packages/query-tools/replay/at-time";
import { isAvailable } from "@/packages/query-tools/replay/items";
import { localClock } from "@/packages/query-tools/replay/local-time";
import { useReplayActions, useReplaySnapshot } from "../../replay/replay-provider";
import { stepReplayOnArrow } from "../../replay/replay-seek-keys";
import { YOUR_DAY_COPY } from "../../twin-page-copy";
import { vitalReadingAt, type VitalSeries } from "../replay/your-day-vitals";
import styles from "../replay/your-day-replay.module.css";
import {
  intervalEndMs,
  plottedValueAt,
  type YourDayChartData,
  type YourDayChartDefinition,
} from "./your-day-charts";

const COPY = YOUR_DAY_COPY.chart;
const TICKS = [0, 0.25, 0.5, 0.75, 1];
const valueText = (value: number) => formatNumber(value, Number.isInteger(value) ? 0 : 1);
const clockAt = (ms: number, zone: string) => localClock(new Date(ms), zone);
const timestamp = (ms: number, zone: string) => {
  const { time, offset } = clockAt(ms, zone);
  return `${time} UTC${offset}`;
};

export function YourDayChart({
  chart,
  data,
  vitalSeries,
  selected = false,
  onClick,
  onRemove,
}: Readonly<{
  chart: YourDayChartDefinition;
  data: YourDayChartData | null;
  vitalSeries?: VitalSeries;
  selected?: boolean;
  onClick?: () => void;
  onRemove: () => void;
}>) {
  const heading = useId();
  const { id, label, selector, view } = chart;
  const { label: unit, presentation, scale, axis, accent } = view;
  const summary = presentation === "nightly-summary" || presentation === "daily-summary";
  const intervals = presentation === "intervals";
  const points = presentation === "points";
  const { cursorMs, startMs, endMs, selection } = useReplaySnapshot();
  const { seek, step } = useReplayActions();
  const { time_zone: zone } = selection;
  const duration = endMs - startMs;
  const x = (ms: number) => ((ms - startMs) / duration) * 100;
  const cursorLeft = `${x(cursorMs)}%`;
  const bandState =
    id === "resting_heart_rate" || id === "hrv_rmssd" ? data?.bands?.[id] : undefined;
  const band = bandState?.state === "available" ? bandState : null;
  const model = useMemo(() => {
    if (!data) return null;
    const series = selector ? seriesOf(data.day, selector) : [];
    const observations = selector
      ? series.filter(isAvailable)
      : (chart.observations ?? [])
          .filter(({ day }) => day === data.day.day)
          .map((row) => ({
            ...row,
            source: { name: row.source },
          }));
    const plot = selector && !summary && !points ? chartSeries(data.day, selector) : null;
    const segments =
      plot?.segments.map((segment) =>
        segment.map(({ id, at, value }) => ({
          id,
          ms: Date.parse(at),
          value: value * scale,
        })),
      ) ?? [];
    const values = observations.map(({ value }) => value * scale);
    const range = values.length ? extent(values) : null;
    const ticks =
      !range || summary
        ? []
        : axis === "count"
          ? countTicks(range[1], 2)
          : niceTicks(
              intervals ? Math.min(0, range[0]) : range[0],
              intervals ? Math.max(0, range[1]) : range[1],
              2,
            );
    const floor = ticks[0] ?? 0;
    const ceiling = ticks.at(-1) ?? 1;
    const y = (value: number) => ((ceiling - value) / (ceiling - floor)) * 100;
    return { series, observations, segments, gaps: plot?.gaps ?? [], range, ticks, y };
  }, [data, selector, chart.observations, summary, points, intervals, scale, axis]);
  const ticks = useMemo(
    () =>
      TICKS.map((fraction) =>
        clockAt(Math.min(endMs - 1, startMs + fraction * duration), zone),
      ),
    [startMs, endMs, duration, zone],
  );
  const current = model ? readingInSeriesAt(model.series, cursorMs) : null;
  const currentReading = selector
    ? current?.state === "available"
      ? current.reading
      : null
    : (model?.observations.findLast(({ at, interval_min }) => {
        const from = Date.parse(at);
        return cursorMs >= from && cursorMs < intervalEndMs(from, interval_min);
      }) ?? null);
  const vital = vitalSeries ? vitalReadingAt(vitalSeries, cursorMs) : null;
  const reading = vital
    ? vital.state === "available"
      ? vital.reading
      : null
    : summary || points
      ? (model?.observations.at(-1) ?? null)
      : intervals &&
          currentReading &&
          cursorMs >=
            intervalEndMs(Date.parse(currentReading.at), currentReading.interval_min)
        ? null
        : currentReading;
  const dotValue =
    model && presentation === "line" ? plottedValueAt(model.segments, cursorMs) : null;
  const cursorTime = timestamp(cursorMs, zone);
  const observationTime =
    points && reading ? timestamp(Date.parse(reading.at), zone) : null;
  const value = reading ? valueText(reading.value * (vital ? 1 : scale)) : null;
  const readingDetail = vital ?? (!selector || summary || points ? null : current);
  const detail =
    readingDetail?.state === "stale"
      ? `${COPY.stale} ${timestamp(Date.parse(readingDetail.reading.at), zone)}`
      : readingDetail?.state === "unavailable"
        ? readingDetail.text
        : null;

  return (
    <article
      aria-labelledby={heading}
      data-replay-chart={presentation}
      className="dark surface text-foreground data-[selected=true]:border-primary @container relative isolate flex min-h-0 min-w-0 flex-col p-4 @sm:p-5"
      data-selected={selected}
    >
      {onClick && (
        <button
          type="button"
          className="focus-visible:outline-ring absolute inset-0 z-1 cursor-pointer rounded-xl focus-visible:outline-2 focus-visible:-outline-offset-4"
          aria-label={COPY.focus(label)}
          aria-pressed={selected}
          title={selected ? COPY.resetFocus : COPY.focus(label)}
          onClick={onClick}
        />
      )}
      <header className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-1">
          <h4 id={heading} className="text-sm font-semibold">
            {label}
          </h4>
          {!summary && model?.range && model.range[0] !== model.range[1] && (
            <p className="text-muted-foreground text-xs tabular-nums">
              {COPY.dailyRange}{" "}
              <span className="whitespace-nowrap">
                {valueText(model.range[0])}–{valueText(model.range[1])} {unit}
              </span>
            </p>
          )}
        </div>
        <button
          type="button"
          className="bg-muted text-muted-foreground hover:text-foreground focus-visible:outline-ring relative z-10 grid size-8 shrink-0 place-items-center rounded-md focus-visible:outline-2"
          aria-label={COPY.remove(label)}
          onClick={onRemove}
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </header>
      {(summary || observationTime) && (
        <p className="text-muted-foreground mt-3 text-xs">
          {summary
            ? presentation === "daily-summary"
              ? COPY.dailySummary
              : COPY.nightlySummary
            : `${vital ? "Reading at cursor:" : COPY.lastObservation} ${observationTime}`}
        </p>
      )}
      <p className="mt-3 text-3xl leading-none font-semibold tabular-nums">
        {value ?? COPY.noData}{" "}
        <span className="text-muted-foreground text-sm font-normal">{unit}</span>
      </p>
      <div className="sr-only">
        {data?.day.origin === "synthetic_demo" && <p>{COPY.syntheticDemo}</p>}
        {reading && (
          <p>
            {reading.provenance} · {reading.source.name} ·{" "}
            {summary && !selector
              ? selection.day
              : timestamp(Date.parse(reading.at), zone)}
          </p>
        )}
        {!vital && detail && <p>{detail}</p>}
        {!data && <p>{COPY.noReadings}</p>}
        {bandState?.state === "unavailable" && <p>{bandState.text}</p>}
        {model && model.gaps.length > 0 && (
          <p>
            {COPY.gaps(model.gaps.length)}
            {model.gaps.map(
              ({ from, to }) =>
                `; ${timestamp(Date.parse(from), zone)} ${COPY.to} ${Date.parse(to) === endMs ? COPY.endOfDay : timestamp(Date.parse(to), zone)}`,
            )}
          </p>
        )}
      </div>
      {vital && detail && <p className="text-muted-foreground mt-1 text-xs">{detail}</p>}
      {summary && band && (
        <p className="text-muted-foreground mt-3 text-xs">
          {COPY.band} {valueText(band.low * scale)}–{valueText(band.high * scale)} {unit}.
          <span className="sr-only"> {band.rule}</span>
        </p>
      )}
      {!summary && (
        <div className="mt-3 flex min-h-0 flex-1 flex-col pl-9 text-xs tabular-nums">
          <div className="relative min-h-24 flex-1 @2xl/replay:min-h-16">
            {data && (
              <input
                type="range"
                aria-label={`${label} ${COPY.cursor}`}
                aria-valuetext={
                  points && !vital
                    ? cursorTime
                    : `${cursorTime}, ${value === null ? COPY.noDataLower : `${value} ${unit}`}`
                }
                className={`${styles.seek} focus-visible:outline-ring absolute inset-0 z-10 size-full cursor-crosshair rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2`}
                min={0}
                max={duration - 1}
                value={cursorMs - startMs}
                onChange={(event) => seek(startMs + event.currentTarget.valueAsNumber)}
                onKeyDown={(event) => stepReplayOnArrow(event, step)}
              />
            )}
            {model?.ticks.map((tick) => (
              <span
                key={tick}
                aria-hidden="true"
                className="text-muted-foreground pointer-events-none absolute -left-9 -translate-y-1/2"
                style={{ top: `${model.y(tick)}%` }}
              >
                {valueText(tick)}
              </span>
            ))}
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 size-full overflow-visible"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              {model?.ticks.map((tick) => (
                <line
                  key={tick}
                  x1={0}
                  x2={100}
                  y1={model.y(tick)}
                  y2={model.y(tick)}
                  className="stroke-border"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {intervals &&
                model?.observations.map(({ id, at, interval_min, value }) => {
                  const atMs = Date.parse(at);
                  const from = Math.max(startMs, atMs);
                  const to = Math.min(endMs, intervalEndMs(atMs, interval_min));
                  const y = model.y(value * scale);
                  const zero = model.y(0);
                  return (
                    <rect
                      key={id}
                      x={x(from)}
                      width={x(to) - x(from)}
                      y={Math.min(y, zero)}
                      height={Math.abs(zero - y)}
                      className="fill-chart-3/70 stroke-card"
                      vectorEffect="non-scaling-stroke"
                    />
                  );
                })}
              {presentation === "line" &&
                model?.segments
                  .filter((segment) => segment.length > 1)
                  .map((segment) => (
                    <polyline
                      key={segment[0]!.id}
                      points={segment
                        .map(({ ms, value }) => `${x(ms)},${model.y(value)}`)
                        .join(" ")}
                      className={
                        accent === "warm"
                          ? "stroke-chart-2 fill-none"
                          : "stroke-chart-3 fill-none"
                      }
                      strokeWidth={2}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
            </svg>
            {model &&
              (points
                ? model.observations.map(({ id, at, value }) => ({
                    id,
                    ms: Date.parse(at),
                    value: value * scale,
                  }))
                : presentation === "line"
                  ? model.segments.flatMap((segment) =>
                      segment.length === 1 ? segment : [],
                    )
                  : []
              ).map((point) => (
                <span
                  key={point.id}
                  data-replay-observation={points ? "" : undefined}
                  className="bg-foreground pointer-events-none absolute size-1.5 -translate-1/2 rounded-full"
                  style={{
                    left: `${x(point.ms)}%`,
                    top: `${model.y(point.value)}%`,
                  }}
                />
              ))}
            <span
              className="border-muted-foreground pointer-events-none absolute inset-y-0 -translate-x-1/2 border-l border-dashed"
              style={{ left: cursorLeft }}
            />
            {dotValue !== null && model && (
              <span
                className="border-card bg-foreground pointer-events-none absolute size-3 -translate-1/2 rounded-full border-2"
                style={{
                  left: cursorLeft,
                  top: `${model.y(dotValue)}%`,
                }}
              />
            )}
          </div>
          <div
            aria-hidden="true"
            className="text-muted-foreground relative mt-1 h-4 shrink-0 text-[0.6875rem]"
          >
            {ticks.map(({ time }, index) => (
              <span
                key={index}
                className={
                  index === 0
                    ? "absolute left-0"
                    : index === 4
                      ? "absolute right-0"
                      : `absolute -translate-x-1/2 ${index % 2 ? "hidden @xs:inline" : ""}`
                }
                style={
                  index > 0 && index < 4 ? { left: `${TICKS[index]! * 100}%` } : undefined
                }
              >
                {time}
              </span>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}
