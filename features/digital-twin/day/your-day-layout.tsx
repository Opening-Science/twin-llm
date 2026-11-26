"use client";

import { useState, type ReactNode } from "react";

import { ATLASES, DEFAULT_ATLAS_ID } from "@/packages/anatomy/manifest";

import { ANATOMY_CHANGES_NOTE } from "../anatomy/anatomy-copy";
import { ReplayProvider } from "../replay/replay-provider";
import { YOUR_DAY_COPY } from "../twin-page-copy";
import { YourDayChart } from "./your-day-chart";
import { SAMPLE_CHARTS, SAMPLE_CURSOR_MINUTE } from "./your-day-chart-samples";
import { YourDayDatePicker } from "./your-day-date-picker";
import { YourDayReplay, YourDayReplayClock } from "./your-day-replay";
import { type YourDayReplayData } from "./your-day-replay-events";

const atlas = ATLASES[DEFAULT_ATLAS_ID];

export function YourDayLayout({
  children,
  initialDate,
  demoDays,
  demoIdentity,
}: Readonly<{
  children: ReactNode;
  initialDate: string;
  demoDays: readonly YourDayReplayData[];
  demoIdentity: Pick<YourDayReplayData["selection"], "subject_ref" | "time_zone">;
}>) {
  const [date, setDate] = useState(initialDate);
  const data = demoDays.find(({ selection }) => selection.day === date) ?? null;
  const selection = data?.selection ?? { ...demoIdentity, day: date };
  return (
    <ReplayProvider selection={selection} story={data}>
      <section
        aria-labelledby="your-day-title"
        className="@container/replay mt-6 space-y-4"
      >
        <header className="flex flex-wrap items-end justify-between gap-3">
          <YourDayReplayClock data={data} />
          <YourDayDatePicker selected={date} onSelect={setDate} />
        </header>
        <div className="grid gap-4 @2xl/replay:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <section aria-label={YOUR_DAY_COPY.viewerRegion} className="surface min-w-0">
            {children}
          </section>
          <section
            aria-labelledby="your-day-charts"
            className="grid min-w-0 gap-3 @2xl/replay:auto-rows-fr @2xl/replay:contain-size"
          >
            <h3 id="your-day-charts" className="sr-only">
              {YOUR_DAY_COPY.chartsTitle}
            </h3>
            {SAMPLE_CHARTS.map((chart) => (
              <YourDayChart
                key={`${date}:${chart.label}`}
                {...chart}
                readings={data ? chart.readings : []}
                initialMinute={SAMPLE_CURSOR_MINUTE}
                sample
              />
            ))}
          </section>
        </div>
        <YourDayReplay data={data} />
        <p className="text-muted-foreground text-xs">
          {atlas.attribution} {ANATOMY_CHANGES_NOTE}{" "}
          <a href={atlas.licenceUrl} className="underline">
            CC BY 4.0
          </a>
        </p>
      </section>
    </ReplayProvider>
  );
}
