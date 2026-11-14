import type { BiomarkerCardSpec } from "@/infrastructure/chat-view";

import {
  latestLine,
  positionText,
  rangeBar,
  rangeText,
  readoutText,
  trendText,
} from "./view-text";

/**
 * A lab value against its published range (SPEC 5.5): the latest value large,
 * when and how many readings, then position, range and trend in words. The
 * grey bar is decoration; it never takes a warning colour.
 */
export const BiomarkerView = ({ spec }: Readonly<{ spec: BiomarkerCardSpec }>) => {
  const bar = rangeBar(spec);
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-readout">{readoutText(spec)}</p>
        <p className="text-muted-foreground mt-1 text-xs">{latestLine(spec)}</p>
      </div>
      {bar === null ? null : (
        <div className="relative h-3" aria-hidden="true">
          <span className="bg-border absolute inset-x-0 top-1 h-1 rounded-full" />
          <span
            className="bg-muted-foreground/60 absolute top-1 h-1 rounded-full"
            style={{ left: `${bar.from}%`, width: `${Math.max(1, bar.to - bar.from)}%` }}
          />
          <span
            className="bg-foreground absolute top-0 h-3 w-0.5 rounded-full"
            style={{ left: `calc(${bar.marker}% - 1px)` }}
          />
        </div>
      )}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Position</dt>
        <dd>{positionText(spec)}</dd>
        <dt className="text-muted-foreground">Range</dt>
        <dd>{rangeText(spec)}</dd>
        <dt className="text-muted-foreground">Trend</dt>
        <dd>{trendText(spec)}</dd>
      </dl>
    </div>
  );
};
