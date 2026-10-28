import { formatNumber } from "@/infrastructure/format-measure";

import { ColumnChart } from "./column-chart";
import { type ReadingBin, readingDistribution } from "./reading-counts";
import { type ReadingsResult } from "./reading-reads";

/**
 * Readings per subject as a histogram (subjects per bin of readings, one axis
 * from zero), a line with the median and range, and the same bins as a table.
 * A read that was refused or failed says so in a plain sentence.
 */

const NOT_SHOWN: Readonly<Record<Exclude<ReadingsResult["kind"], "ok">, string>> = {
  "sign-in": "Sign in to see readings per subject.",
  "not-found": "This cohort is not one the Data page shows.",
  "too-large": "This cohort has too many subjects to draw readings per subject.",
  failed: "Readings per subject could not be read. Reload the page to try again.",
};

const binLabel = (bin: ReadingBin): string =>
  bin.to === null
    ? `${formatNumber(bin.from, 0)} or more`
    : bin.from === bin.to
      ? formatNumber(bin.from, 0)
      : `${formatNumber(bin.from, 0)}–${formatNumber(bin.to, 0)}`;

/** The axis names a bin by where it starts; the tooltip and table give the range. */
const axisLabel = (bin: ReadingBin): string =>
  bin.to === null ? `${formatNumber(bin.from, 0)}+` : formatNumber(bin.from, 0);

const count = (value: number | null): string =>
  formatNumber(value, value !== null && !Number.isInteger(value) ? 1 : 0);

export const ReadingsPerSubject = ({
  readings,
  subjects,
}: {
  readonly readings: ReadingsResult;
  /** Every synthetic subject of the cohort; those without a count have 0 readings. */
  readonly subjects: number;
}) => {
  if (readings.kind !== "ok")
    return <p className="text-muted-foreground text-sm">{NOT_SHOWN[readings.kind]}</p>;
  const distribution = readingDistribution(readings.counts, subjects);
  if (distribution.bins.length === 0)
    return <p className="text-muted-foreground text-sm">No subjects.</p>;
  const first = distribution.bins[0]!;
  const width = first.to === null ? null : first.to - first.from + 1;
  const open = distribution.bins.find((bin) => bin.to === null) ?? null;
  return (
    <>
      <p className="max-w-3xl text-[15px] leading-relaxed">
        Median {count(distribution.median)} readings per subject, from{" "}
        {count(distribution.min)} to {count(distribution.max)}.{" "}
        {distribution.withoutReadings === 0
          ? "Every subject has at least one."
          : `${formatNumber(distribution.withoutReadings, 0)} of ${formatNumber(distribution.subjects, 0)} subjects have none.`}
      </p>
      <div className="mt-4">
        <ColumnChart
          label="Subjects by number of numeric readings"
          height={180}
          columns={distribution.bins.map((bin) => ({
            id: String(bin.from),
            label: axisLabel(bin),
            value: bin.subjects,
            detail: [
              ["Readings", binLabel(bin)],
              ["Subjects", formatNumber(bin.subjects, 0)],
            ],
          }))}
        />
      </div>
      <p className="text-muted-foreground mt-2 text-xs">
        Subjects (y) by readings per subject (x), in bins of {formatNumber(width, 0)}
        {open === null
          ? "."
          : `; the last bin holds everyone with ${formatNumber(open.from, 0)} or more.`}
      </p>
      <details className="mt-4">
        <summary className="text-foreground cursor-pointer text-sm font-medium">
          Table
        </summary>
        <div className="relative mt-3 overflow-x-auto">
          <table className="w-full max-w-md border-collapse text-sm">
            <caption className="sr-only">Subjects per bin of numeric readings</caption>
            <thead>
              <tr className="border-border border-b">
                <th scope="col" className="text-eyebrow px-2 py-2 text-left">
                  Readings
                </th>
                <th scope="col" className="text-eyebrow px-2 py-2 text-right">
                  Subjects
                </th>
              </tr>
            </thead>
            <tbody>
              {distribution.bins.map((bin) => (
                <tr key={bin.from} className="border-border border-b last:border-b-0">
                  <td className="px-2 py-1.5 font-mono text-xs tabular-nums">
                    {binLabel(bin)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums">
                    {formatNumber(bin.subjects, 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
};
