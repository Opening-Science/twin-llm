import type { ReactNode } from "react";

import { formatNumber } from "@/infrastructure/format-measure";
import type { ReviewSummary } from "@/packages/personal-data/review-summary";

import { kindLabel } from "./import-formats";
import {
  byteSizeLabel,
  countLabel,
  dateRangeLabel,
  previewCellLabel,
} from "./import-labels";

/**
 * The review step: what Save would store, read from the server's summary.
 * Values appear only in the preview table; everything else is counts,
 * codes, units and reasons.
 */

const Section = ({
  title,
  children,
}: Readonly<{ title: string; children: ReactNode }>) => (
  <section className="mt-5">
    <h4 className="text-eyebrow">{title}</h4>
    <div className="mt-2">{children}</div>
  </section>
);

const TABLE = "w-full border-collapse text-left text-xs";
const TH = "text-muted-foreground border-border border-b px-2 py-1.5 font-medium";
const TD = "border-border border-b px-2 py-1.5 align-top";

const Summary = ({ review }: Readonly<{ review: ReviewSummary }>) => {
  const rows: readonly (readonly [string, string])[] = [
    ["Format", kindLabel(review.kind)],
    ["File", `${review.fileName} (${byteSizeLabel(review.byteSize)})`],
    ...(review.kind === "table"
      ? ([
          ["Rows to store", countLabel(review.counts.tableRows, "row", "rows")],
          ["Columns", countLabel(review.counts.tableColumns, "column", "columns")],
        ] as const)
      : ([
          [
            "Numbers to store",
            countLabel(review.counts.observations, "number", "numbers"),
          ],
        ] as const)),
    ...(review.kind === "fhir"
      ? ([
          [
            "Conditions and medications",
            countLabel(review.counts.clinicalRecords, "record", "records"),
          ],
        ] as const)
      : []),
    ["Not stored", countLabel(review.counts.unmapped, "row", "rows")],
    [
      "Dates",
      review.dateRange === null
        ? "no dates"
        : dateRangeLabel(review.dateRange.first, review.dateRange.last),
    ],
  ];
  return (
    <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="font-mono">{value}</dd>
        </div>
      ))}
    </dl>
  );
};

const Codes = ({ review }: Readonly<{ review: ReviewSummary }>) =>
  review.codes.length === 0 ? null : (
    <Section
      title={
        review.codesTotal > review.codes.length
          ? `Codes found (first ${review.codes.length} of ${review.codesTotal})`
          : "Codes found"
      }
    >
      <div className="overflow-x-auto">
        <table className={TABLE}>
          <thead>
            <tr>
              <th className={TH}>Code</th>
              <th className={TH}>Name</th>
              <th className={TH}>Units</th>
              <th className={`${TH} text-right`}>Rows</th>
            </tr>
          </thead>
          <tbody>
            {review.codes.map((code) => (
              <tr key={`${code.system ?? ""}|${code.code ?? ""}|${code.display}`}>
                <td className={`${TD} font-mono`}>{code.code ?? "no code"}</td>
                <td className={TD}>{code.display}</td>
                <td className={`${TD} font-mono`}>{code.units.join(", ")}</td>
                <td className={`${TD} text-right font-mono`}>
                  {formatNumber(code.count, 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );

const Units = ({ review }: Readonly<{ review: ReviewSummary }>) =>
  review.units.length === 0 ? null : (
    <Section title="Units, stored as written">
      <ul className="flex flex-wrap gap-1.5">
        {review.units.map((unit) => (
          <li key={unit.unit} className="skill-chip">
            {unit.unit} · {formatNumber(unit.count, 0)}
            {unit.ucum ? "" : " · not UCUM"}
          </li>
        ))}
      </ul>
    </Section>
  );

const Columns = ({ review }: Readonly<{ review: ReviewSummary }>) =>
  review.columns.length === 0 ? null : (
    <Section title="Columns">
      <ul className="flex flex-wrap gap-1.5">
        {review.columns.map((column) => (
          <li key={column.name} className="skill-chip">
            {column.name} · {column.type}
            {column.missing > 0 ? ` · ${formatNumber(column.missing, 0)} missing` : ""}
          </li>
        ))}
      </ul>
    </Section>
  );

const Unmapped = ({ review }: Readonly<{ review: ReviewSummary }>) =>
  review.counts.unmapped === 0 ? null : (
    <Section title="Not stored, and why">
      <ul className="grid gap-1 text-sm">
        {review.unmapped.byReason.map((reason) => (
          <li key={reason.code}>
            <span className="font-mono">{formatNumber(reason.count, 0)}</span>{" "}
            <span className="text-muted-foreground">{reason.example}</span>
          </li>
        ))}
      </ul>
      <details className="mt-2 text-xs">
        <summary className="text-muted-foreground cursor-pointer">
          {review.unmapped.listed.length < review.counts.unmapped
            ? `First ${review.unmapped.listed.length} rows`
            : "Each row"}
        </summary>
        <ul className="mt-1 grid gap-0.5">
          {review.unmapped.listed.map((row) => (
            <li key={`${row.where}|${row.code}`}>
              <span className="font-mono">{row.where}</span> {row.reason}
            </li>
          ))}
        </ul>
      </details>
    </Section>
  );

const Preview = ({ review }: Readonly<{ review: ReviewSummary }>) =>
  review.preview.rows.length === 0 ? null : (
    <Section title={`First ${review.preview.rows.length} rows as they will be stored`}>
      <div className="overflow-x-auto">
        <table className={TABLE}>
          <thead>
            <tr>
              {review.preview.columns.map((column) => (
                <th key={column} scope="col" className={TH}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {review.preview.rows.map((row, index) => (
              // Preview rows have no id of their own; their order is fixed.
              <tr key={index}>
                {row.map((cell, column) => (
                  <td key={review.preview.columns[column]} className={`${TD} font-mono`}>
                    {previewCellLabel(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );

export const ReviewView = ({ review }: Readonly<{ review: ReviewSummary }>) => (
  <div>
    <Summary review={review} />
    {review.notes.length > 0 && (
      <ul className="text-muted-foreground mt-4 grid gap-1 text-sm">
        {review.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    )}
    <Codes review={review} />
    <Units review={review} />
    <Columns review={review} />
    <Unmapped review={review} />
    <Preview review={review} />
  </div>
);
