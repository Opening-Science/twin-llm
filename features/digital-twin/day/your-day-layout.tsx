"use client";

import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { useMemo, useRef, useState, type ReactNode, type Ref } from "react";

import { useReducedMotion } from "@/infrastructure/ui-kit/use-reduced-motion";
import { ATLASES, DEFAULT_ATLAS_ID } from "@/packages/anatomy/manifest";

import { ANATOMY_CHANGES_NOTE } from "../anatomy/anatomy-copy";
import { ReplayProvider } from "../replay/replay-provider";
import { YOUR_DAY_COPY } from "../twin-page-copy";
import { YourDayChart } from "./your-day-chart";
import { YourDayChartPicker } from "./your-day-chart-picker";
import { MAX_YOUR_DAY_CHARTS, type YourDayChartId } from "./your-day-charts";
import { YourDayDatePicker } from "./your-day-date-picker";
import { buildPickerCatalog } from "./your-day-picker-catalog";
import { YourDayReplay, YourDayReplayClock } from "./your-day-replay";
import { type YourDayDemo } from "./your-day-replay-demo";

const atlas = ATLASES[DEFAULT_ATLAS_ID];

function AnimatedChartCard({
  children,
  reducedMotion,
  ref,
}: Readonly<{
  children: ReactNode;
  reducedMotion: boolean;
  ref?: Ref<HTMLDivElement>;
}>) {
  const isPresent = useIsPresent();
  return (
    <motion.div
      ref={ref}
      className="grid min-w-0"
      inert={!isPresent}
      layout={reducedMotion ? false : "position"}
      initial={reducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reducedMotion ? undefined : { opacity: 0, y: -8 }}
      transition={{ duration: reducedMotion ? 0 : 0.2, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

export function YourDayLayout({
  children,
  initialDate,
  demoDays,
  demoIdentity,
  initialChartIds,
  personal = false,
}: Readonly<{
  children: ReactNode;
  initialDate: string;
  demoDays: readonly YourDayDemo[];
  demoIdentity: Pick<YourDayDemo["selection"], "subject_ref" | "time_zone">;
  initialChartIds?: readonly YourDayChartId[];
  personal?: boolean;
}>) {
  const [date, setDate] = useState(initialDate);
  const catalog = useMemo(
    () =>
      buildPickerCatalog(
        demoDays.map(({ chartData }) => chartData.day),
        undefined,
        demoDays.flatMap(({ observations }) => observations ?? []),
      ),
    [demoDays],
  );
  const chartById = new Map(catalog.charts.map((chart) => [chart.id, chart]));
  const [chartIds, setChartIds] = useState<readonly YourDayChartId[]>(() =>
    [...new Set(initialChartIds ?? chartById.keys())]
      .filter((id) => chartById.has(id))
      .slice(0, MAX_YOUR_DAY_CHARTS),
  );
  const reducedMotion = useReducedMotion();
  const chartsTitle = useRef<HTMLHeadingElement>(null);
  const data = demoDays.find(({ selection }) => selection.day === date) ?? null;
  const selection = data?.selection ?? { ...demoIdentity, day: date };
  return (
    <ReplayProvider selection={selection} story={data}>
      <section
        aria-labelledby="your-day-title"
        className="@container/replay mt-6 space-y-2"
      >
        <header className="flex flex-wrap items-center justify-between gap-3">
          <YourDayReplayClock data={data} />
          <div className="ml-auto flex max-w-full min-w-0 items-center gap-2">
            <YourDayDatePicker
              selected={date}
              onSelect={(next) => {
                if (!personal) return setDate(next);
                const url = new URL(window.location.href);
                url.search = new URLSearchParams({
                  date: next,
                  zone: demoIdentity.time_zone,
                }).toString();
                window.location.assign(url);
              }}
            />
            <YourDayChartPicker
              catalog={catalog}
              active={chartIds}
              onApply={setChartIds}
            />
          </div>
          {personal && catalog.charts.length === 0 && (
            <p role="status" className="text-muted-foreground text-sm">
              No imported or synced wearable readings for this date.
            </p>
          )}
        </header>
        <div className="grid gap-4 @2xl/replay:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]">
          <section aria-label={YOUR_DAY_COPY.viewerRegion} className="surface min-w-0">
            {children}
          </section>
          <section
            aria-labelledby="your-day-charts"
            className="@container/charts flex min-w-0 flex-col gap-3"
          >
            <h3 id="your-day-charts" ref={chartsTitle} tabIndex={-1} className="sr-only">
              {YOUR_DAY_COPY.chartsTitle}
            </h3>
            <div
              className={`relative grid min-w-0 flex-1 gap-3 @2xl/replay:auto-rows-fr ${chartIds.length > 2 ? "@lg/charts:grid-cols-2" : ""} ${chartIds.length > 4 ? "@min-[48rem]/charts:grid-cols-3" : ""}`}
            >
              <AnimatePresence
                initial={false}
                mode={reducedMotion ? "sync" : "popLayout"}
              >
                {chartIds.length === 0 && (
                  <AnimatedChartCard key="empty" reducedMotion={reducedMotion}>
                    <p className="surface text-muted-foreground grid place-items-center p-4 text-center text-sm">
                      {YOUR_DAY_COPY.chart.empty}
                    </p>
                  </AnimatedChartCard>
                )}
                {chartIds.flatMap((id) => {
                  const chart = chartById.get(id);
                  if (!chart) return [];
                  return (
                    <AnimatedChartCard key={id} reducedMotion={reducedMotion}>
                      <YourDayChart
                        chart={chart}
                        data={data?.chartData ?? null}
                        onRemove={() => {
                          setChartIds((ids) => ids.filter((chartId) => chartId !== id));
                          chartsTitle.current?.focus({ preventScroll: true });
                        }}
                      />
                    </AnimatedChartCard>
                  );
                })}
              </AnimatePresence>
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
