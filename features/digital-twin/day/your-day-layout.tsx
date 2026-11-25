"use client";

import { useRef, useState, type ReactNode } from "react";

import { ATLASES, DEFAULT_ATLAS_ID } from "@/packages/anatomy/manifest";

import { ANATOMY_CHANGES_NOTE } from "../anatomy/anatomy-copy";
import { YourDayChart } from "./your-day-chart";
import { DEFAULT_CHART_IDS, type YourDayChartId } from "./your-day-charts";
import { YourDayDatePicker } from "./your-day-date-picker";
import { ReplayProvider } from "../replay/replay-provider";
import { YourDayReplay, YourDayReplayClock } from "./your-day-replay";
import { type YourDayDemo } from "./your-day-replay-demo";

const atlas = ATLASES[DEFAULT_ATLAS_ID];

export function YourDayLayout({
  children,
  initialDate,
  demoDays,
  demoIdentity,
  initialChartIds = DEFAULT_CHART_IDS,
}: Readonly<{
  children: ReactNode;
  initialDate: string;
  demoDays: readonly YourDayDemo[];
  demoIdentity: Pick<YourDayDemo["selection"], "subject_ref" | "time_zone">;
  initialChartIds?: readonly YourDayChartId[];
}>) {
  const [date, setDate] = useState(initialDate);
  const [chartIds, setChartIds] = useState(() =>
    [...new Set(initialChartIds)].slice(0, 6),
  );
  const chartsTitle = useRef<HTMLHeadingElement>(null);
  const data = demoDays.find(({ selection }) => selection.day === date) ?? null;
  const selection = data?.selection ?? { ...demoIdentity, day: date };
  return (
    <ReplayProvider selection={selection} story={data}>
      <section
        aria-labelledby="your-day-title"
        className="@container/replay mt-6 space-y-2"
      >
        <header className="flex flex-wrap items-end justify-between gap-3">
          <YourDayReplayClock data={data} />
          <YourDayDatePicker selected={date} onSelect={setDate} />
        </header>
        <div className="grid gap-4 @2xl/replay:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]">
          <section aria-label="Anatomy viewer" className="surface min-w-0">
            {children}
          </section>
          <section
            aria-labelledby="your-day-charts"
            className="@container/charts min-w-0"
          >
            <h3 id="your-day-charts" ref={chartsTitle} tabIndex={-1} className="sr-only">
              Biomarker charts
            </h3>
            <div
              className={`grid h-full min-w-0 gap-3 @2xl/replay:auto-rows-fr ${chartIds.length > 2 ? "@lg/charts:grid-cols-2" : ""} ${chartIds.length > 4 ? "@min-[48rem]/charts:grid-cols-3" : ""}`}
            >
              {chartIds.length === 0 && (
                <p className="surface text-muted-foreground grid place-items-center p-4 text-center text-sm">
                  Add charts to see biomarker readings here.
                </p>
              )}
              {chartIds.map((id) => (
                <YourDayChart
                  key={id}
                  id={id}
                  data={data?.chartData ?? null}
                  onRemove={() => {
                    setChartIds((ids) => ids.filter((chartId) => chartId !== id));
                    chartsTitle.current?.focus({ preventScroll: true });
                  }}
                />
              ))}
            </div>
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
