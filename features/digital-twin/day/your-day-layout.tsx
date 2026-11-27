"use client";

import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { useMemo, useRef, useState, type ReactNode, type Ref } from "react";

import { useReducedMotion } from "@/infrastructure/ui-kit/use-reduced-motion";
import { ATLASES, DEFAULT_ATLAS_ID } from "@/packages/anatomy/manifest";

import { ANATOMY_CHANGES_NOTE } from "../anatomy/anatomy-copy";
import { ReplayProvider } from "../replay/replay-provider";
import { YOUR_DAY_COPY } from "../twin-page-copy";
import { YourDayChart } from "./charts/your-day-chart";
import { YourDayChartPicker } from "./charts/your-day-chart-picker";
import { MAX_YOUR_DAY_CHARTS, type YourDayChartId } from "./charts/your-day-charts";
import { YourDayDatePicker } from "./your-day-date-picker";
import { buildPickerCatalog } from "./charts/your-day-picker-catalog";
import { YourDayReplay, YourDayReplayClock } from "./replay/your-day-replay";
import { YourDayVitalsPanel } from "./replay/your-day-vitals-panel";
import { vitalSeriesForChart } from "./replay/your-day-vitals";
import { type YourDayDemo } from "./data/your-day-replay-demo";
import { yourDayChartFocus, type YourDayCameraRequest } from "./your-day-camera";

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
      className="grid min-h-0 min-w-0 @2xl/replay:contain-size"
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
  children?: ReactNode;
  initialDate: string;
  demoDays: readonly YourDayDemo[];
  demoIdentity: Pick<YourDayDemo["selection"], "subject_ref" | "time_zone">;
  initialChartIds?: readonly YourDayChartId[];
  personal?: boolean;
}>) {
  const [date, setDate] = useState(initialDate);
  const [cameraRequest, setCameraRequest] = useState<YourDayCameraRequest>();
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
  const activeDay = data?.chartData.day;
  const vitalSeries = new Map(
    activeDay
      ? catalog.charts.flatMap((chart) => {
          const series = vitalSeriesForChart(chart, activeDay, activeDay);
          return series ? [[series.id, series] as const] : [];
        })
      : [],
  );
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
                // Only the date goes in the URL; the zone stays in its cookie.
                url.search = new URLSearchParams({ date: next }).toString();
                window.location.assign(url);
              }}
            />
            <YourDayChartPicker
              catalog={catalog}
              active={chartIds}
              onApply={(ids) => {
                setChartIds(ids);
                setCameraRequest((request) =>
                  request && ids.includes(request.chartId) ? request : undefined,
                );
              }}
            />
          </div>
          {personal && catalog.charts.length === 0 && (
            <p role="status" className="text-muted-foreground text-sm">
              {YOUR_DAY_COPY.personal.noReadings}
            </p>
          )}
        </header>
        <div className="grid gap-4 @2xl/replay:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]">
          <section aria-label={YOUR_DAY_COPY.viewerRegion} className="surface min-w-0">
            {children}
            <YourDayVitalsPanel
              key={JSON.stringify([
                selection.subject_ref,
                selection.day,
                selection.time_zone,
              ])}
              series={vitalSeries}
              reducedMotion={reducedMotion}
              personal={personal}
              cameraRequest={cameraRequest}
            />
          </section>
          <section
            aria-labelledby="your-day-charts"
            className="@container/charts flex min-w-0 flex-col gap-3"
          >
            <h3 id="your-day-charts" ref={chartsTitle} tabIndex={-1} className="sr-only">
              {YOUR_DAY_COPY.chartsTitle}
            </h3>
            <div
              className={`relative grid min-w-0 flex-1 gap-3 overflow-x-clip @2xl/replay:auto-rows-[minmax(15.5rem,1fr)] ${chartIds.length > 2 ? "@lg/charts:grid-cols-2" : ""} ${chartIds.length > 4 ? "@min-[48rem]/charts:grid-cols-3" : ""}`}
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
                  const region = yourDayChartFocus(chart);
                  return (
                    <AnimatedChartCard key={id} reducedMotion={reducedMotion}>
                      <YourDayChart
                        chart={chart}
                        data={data?.chartData ?? null}
                        vitalSeries={vitalSeries.get(id)}
                        selected={cameraRequest?.chartId === id}
                        onClick={
                          region
                            ? () =>
                                setCameraRequest((request) =>
                                  request?.chartId === id
                                    ? undefined
                                    : { chartId: id, region },
                                )
                            : undefined
                        }
                        onRemove={() => {
                          setChartIds((ids) => ids.filter((chartId) => chartId !== id));
                          setCameraRequest((request) =>
                            request?.chartId === id ? undefined : request,
                          );
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
          {" · "}
          <a
            href="https://github.com/Opening-Science/twin-llm/blob/main/docs/glucose-particles.md#attribution"
            className="underline"
          >
            Particle credits
          </a>
        </p>
      </section>
    </ReplayProvider>
  );
}
