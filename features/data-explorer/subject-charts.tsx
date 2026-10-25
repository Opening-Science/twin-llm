"use client";

import { useRef, useState } from "react";

import { formatDate, formatNumber } from "@/infrastructure/format-measure";
import { Button } from "@/infrastructure/ui-kit/button";
import { Field } from "@/infrastructure/ui-kit/field";

import { formatReading, type SubjectSeries } from "./subject-series";
import { TimeLineChart } from "./time-line-chart";

/**
 * One subject's measurements: a chart for the chosen code and unit, and a
 * table of every series with its latest value and how well it covers the
 * record. Choosing a row's "Chart" or the select shows that series. A code
 * stored in two units is two rows and two charts, never one mixed line.
 */

const day = (iso: string) => iso.slice(0, 10);

const optionLabel = (series: SubjectSeries) =>
  `${series.display} (${series.unit}) · ${formatNumber(series.readings, 0)} readings`;

export const SubjectCharts = ({
  series,
}: {
  readonly series: readonly SubjectSeries[];
}) => {
  const [selected, setSelected] = useState(series[0]?.key ?? "");
  const chartRef = useRef<HTMLElement>(null);
  const current = series.find((s) => s.key === selected) ?? series[0];
  if (!current) {
    return (
      <p className="text-muted-foreground mt-4 text-sm">
        This subject has no numeric observations.
      </p>
    );
  }

  return (
    <>
      <section ref={chartRef} className="surface mt-6 min-w-0 scroll-mt-4 p-6">
        <h2 className="font-display text-xl">Measurements over time</h2>
        <Field
          as="select"
          label="Measurement"
          className="mt-3 max-w-xl"
          value={current.key}
          onChange={(event) => setSelected(event.target.value)}
        >
          {series.map((s) => (
            <option key={s.key} value={s.key}>
              {optionLabel(s)}
            </option>
          ))}
        </Field>
        <p className="text-muted-foreground mt-3 font-mono text-xs">
          LOINC {current.loinc} · {current.unit} · {formatDate(current.firstDay)} to{" "}
          {formatDate(current.lastDay)}
        </p>
        {current.unitsForCode > 1 && (
          <p className="text-muted-foreground mt-1 text-sm">
            This code is stored in {current.unitsForCode} units for this subject. Each
            unit has its own chart; nothing is converted.
          </p>
        )}
        <div className="mt-3">
          {current.readings < 2 ? (
            <p className="text-muted-foreground text-sm">
              One reading: {formatReading(current.latest.value, current.decimals)}{" "}
              {current.unit} on {formatDate(day(current.latest.at))}. Too few to draw a
              line.
            </p>
          ) : (
            <TimeLineChart
              key={current.key}
              points={current.points}
              unit={current.unit}
              decimals={current.decimals}
              label={`${current.display} in ${current.unit} over time, ${current.readings} readings`}
            />
          )}
          {current.points.length < current.readings && (
            <p className="text-muted-foreground mt-2 text-xs">
              Drawn from {formatNumber(current.points.length, 0)} of{" "}
              {formatNumber(current.readings, 0)} readings: the lowest and highest of each
              stretch, exact values. The table counts every reading.
            </p>
          )}
        </div>
      </section>

      <section className="surface mt-6 min-w-0 p-6">
        <h2 className="font-display text-xl">Latest values and coverage</h2>
        <p className="text-muted-foreground mt-1 max-w-2xl text-sm leading-relaxed">
          One row per code and unit. Days counts the distinct UTC days with a reading.
        </p>
        <div className="relative mt-4 overflow-x-auto">
          <table className="w-full min-w-2xl border-collapse text-sm">
            <caption className="sr-only">
              Every measurement of this subject with its latest value and coverage
            </caption>
            <thead>
              <tr className="border-border border-b">
                {["Measurement", "Latest", "Readings", "Days", "First", "Last", ""].map(
                  (heading, index) => (
                    <th
                      key={heading || index}
                      scope="col"
                      className={`text-eyebrow px-2 py-2 ${index >= 2 && index <= 3 ? "text-right" : "text-left"}`}
                    >
                      {heading || <span className="sr-only">Chart</span>}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {series.map((s) => (
                <tr
                  key={s.key}
                  className={`border-border border-b last:border-b-0 ${s.key === current.key ? "bg-muted/60" : ""}`}
                >
                  <td className="px-2 py-1.5">
                    <span className="block">{s.display}</span>
                    <span className="text-muted-foreground font-mono text-xs">
                      {s.loinc}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 font-mono text-xs whitespace-nowrap tabular-nums">
                    {formatReading(s.latest.value, s.decimals)} {s.unit}
                    <span className="text-muted-foreground block">
                      {formatDate(day(s.latest.at))}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums">
                    {formatNumber(s.readings, 0)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums">
                    {formatNumber(s.days, 0)}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-xs whitespace-nowrap">
                    {formatDate(s.firstDay)}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-xs whitespace-nowrap">
                    {formatDate(s.lastDay)}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-pressed={s.key === current.key}
                      aria-label={`Chart ${s.display} in ${s.unit}`}
                      onClick={() => {
                        setSelected(s.key);
                        chartRef.current?.scrollIntoView({
                          behavior: "smooth",
                          block: "start",
                        });
                      }}
                    >
                      Chart
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
};
