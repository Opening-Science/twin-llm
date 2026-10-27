import type { BiomarkerCardSpec } from "@/infrastructure/chat-view";

import {
  dayText,
  positionText,
  rangeBar,
  rangeSourceText,
  rangeText,
  trendText,
  valueText,
} from "./view-text";

const percent = (fraction: number): string =>
  `${(Math.min(1, Math.max(0, fraction)) * 100).toFixed(2)}%`;

/**
 * `biomarker.card`: the latest reading, the Anchor v3 range it was placed
 * against and the trend over the window. The bar is neutral grey whatever the
 * position; the words say within, above or below.
 */
export const BiomarkerCard = ({ spec }: Readonly<{ spec: BiomarkerCardSpec }>) => {
  const range = rangeText(spec);
  const source = rangeSourceText(spec);
  const bar = rangeBar(spec);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-2xl tabular-nums">{valueText(spec)}</span>
        <span className="text-muted-foreground text-xs">
          latest, {dayText(spec.at)} · {spec.n} {spec.n === 1 ? "reading" : "readings"} in
          the window
        </span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Position</dt>
        <dd className="font-medium">{positionText(spec)}</dd>
        {range !== null && (
          <>
            <dt className="text-muted-foreground">Range</dt>
            <dd>
              <span className="font-mono tabular-nums">{range}</span>
              {source !== null && (
                <span className="text-muted-foreground text-xs"> ({source})</span>
              )}
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">Trend</dt>
        <dd>{trendText(spec)}</dd>
      </dl>
      {bar !== null && (
        <div className="relative h-3 w-full" aria-hidden="true">
          <div className="bg-muted absolute inset-x-0 top-1 h-1 rounded-full" />
          <div
            className="bg-muted-foreground/40 absolute top-0.5 h-2 rounded-sm"
            style={{ left: percent(bar.from), width: percent(bar.to - bar.from) }}
          />
          <div
            className="bg-foreground absolute top-0 h-3 w-0.5 -translate-x-1/2"
            style={{ left: percent(bar.marker) }}
          />
        </div>
      )}
    </div>
  );
};
