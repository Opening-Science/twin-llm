"use client";

import type { CompareSpec, ViewPoint } from "@/infrastructure/chat-view";

import { LinePlot, valueAxis } from "./view-timeseries";
import {
  comparisonAlt,
  compareDecimals,
  dayOf,
  deltaLine,
  NO_READINGS_IN_EITHER,
  pointTime,
  seriesDomain,
  windowSummary,
} from "./view-text";

/**
 * Two windows on one value axis (SPEC 5.5): side by side, each panel on its
 * own dates, or overlaid, both from day 1 of their window. The earlier window
 * is a grey dashed line, the later the chart colour, each with its mean. The
 * words under the chart say each window's n and mean and the difference, so
 * nothing depends on telling the colours apart.
 */

const DAY_MS = 86_400_000;

const sinceStart =
  (start: string) =>
  (point: ViewPoint): number =>
    pointTime(point) - Date.parse(start.length === 10 ? `${start}T00:00:00Z` : start);

const dayTicks = (span: number) => {
  const days = Math.max(1, Math.round(span / DAY_MS));
  const step = Math.max(1, Math.ceil(days / 5));
  return Array.from({ length: Math.floor(days / step) + 1 }, (_, i) => ({
    time: i * step * DAY_MS,
    label: `Day ${String(i * step + 1)}`,
  }));
};

export const ComparisonView = ({
  title,
  spec,
}: Readonly<{ title: string; spec: CompareSpec }>) => {
  const { before, after } = spec;
  if (before.n === 0 && after.n === 0) {
    return <p className="text-muted-foreground text-sm">{NO_READINGS_IN_EITHER}</p>;
  }
  const decimals = compareDecimals(spec);
  const ticks = valueAxis([
    ...before.points.map((point) => point.value),
    ...after.points.map((point) => point.value),
    ...(before.mean === null ? [] : [before.mean]),
    ...(after.mean === null ? [] : [after.mean]),
  ]);
  const delta = deltaLine(spec.meanDelta, spec.unit, decimals, spec.label);
  const span = (window: Readonly<{ start: string; end: string }>) => {
    const [from, to] = seriesDomain([], window);
    return to - from;
  };
  return (
    <div className="flex flex-col gap-2">
      <div role="img" aria-label={comparisonAlt(title, spec)}>
        {spec.layout === "overlaid" ? (
          <LinePlot
            series={[
              {
                points: before.points,
                timeOf: sinceStart(before.start),
                earlier: true,
                mean: before.mean,
              },
              { points: after.points, timeOf: sinceStart(after.start), mean: after.mean },
            ]}
            domain={[0, Math.max(span(before), span(after))]}
            timeTicks={dayTicks(Math.max(span(before), span(after)))}
            valueTicks={ticks}
            decimals={decimals}
          />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <LinePlot
              series={[{ points: before.points, earlier: true, mean: before.mean }]}
              domain={seriesDomain(before.points, before)}
              valueTicks={ticks}
              decimals={decimals}
              height={160}
            />
            <LinePlot
              series={[{ points: after.points, mean: after.mean }]}
              domain={seriesDomain(after.points, after)}
              valueTicks={ticks}
              decimals={decimals}
              height={160}
            />
          </div>
        )}
      </div>
      <dl className="grid gap-x-3 gap-y-0.5 text-xs sm:grid-cols-[auto_minmax(0,1fr)]">
        <dt className="text-muted-foreground">
          Earlier (dashed), {dayOf(before.start)} – {dayOf(before.end)}
        </dt>
        <dd className="font-mono">
          {windowSummary(before, spec.unit, decimals, spec.label)}
        </dd>
        <dt className="text-muted-foreground">
          Later, {dayOf(after.start)} – {dayOf(after.end)}
        </dt>
        <dd className="font-mono">
          {windowSummary(after, spec.unit, decimals, spec.label)}
        </dd>
      </dl>
      {delta === null ? null : <p className="text-sm">{delta}</p>}
    </div>
  );
};
