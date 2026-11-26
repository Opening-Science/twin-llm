import { type ReactNode } from "react";

import { ATLASES, DEFAULT_ATLAS_ID } from "@/packages/anatomy/manifest";

import { ANATOMY_CHANGES_NOTE } from "../anatomy/anatomy-copy";
import { YOUR_DAY_COPY } from "../twin-page-copy";
import { YourDayChart } from "./your-day-chart";
import { SAMPLE_CHARTS, SAMPLE_CURSOR_MINUTE } from "./your-day-chart-samples";
import { YourDayDatePicker } from "./your-day-date-picker";

const atlas = ATLASES[DEFAULT_ATLAS_ID];

export function YourDayLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <section aria-labelledby="your-day-title" className="@container mt-6 space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="bg-muted text-muted-foreground flex items-center gap-2 rounded-full px-3 py-1 text-xs">
          <h2 id="your-day-title">{YOUR_DAY_COPY.clock}</h2>
          <span className="sr-only">{YOUR_DAY_COPY.clockUnavailable}</span>
          <span aria-hidden="true" className="font-mono">
            --:--
          </span>
        </div>
        <YourDayDatePicker />
      </header>
      <div className="grid items-start gap-4 @2xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section aria-label={YOUR_DAY_COPY.viewerRegion} className="surface min-w-0">
          {children}
        </section>
        <section aria-labelledby="your-day-charts" className="min-w-0 space-y-3">
          <h3 id="your-day-charts" className="sr-only">
            {YOUR_DAY_COPY.chartsTitle}
          </h3>
          {SAMPLE_CHARTS.map((chart) => (
            <YourDayChart
              key={chart.label}
              {...chart}
              initialMinute={SAMPLE_CURSOR_MINUTE}
              sample
            />
          ))}
        </section>
      </div>
      <section aria-labelledby="your-day-replay" className="surface p-4">
        <h3 id="your-day-replay" className="font-medium">
          {YOUR_DAY_COPY.replayTitle}
        </h3>
        <div aria-hidden="true" className="bg-muted mt-3 h-2 rounded-full" />
        <p className="text-muted-foreground mt-2 text-sm">
          {YOUR_DAY_COPY.replayUnavailable}
        </p>
      </section>
      <p className="text-muted-foreground text-xs">
        {atlas.attribution} {ANATOMY_CHANGES_NOTE}{" "}
        <a href={atlas.licenceUrl} className="underline">
          CC BY 4.0
        </a>
      </p>
    </section>
  );
}
