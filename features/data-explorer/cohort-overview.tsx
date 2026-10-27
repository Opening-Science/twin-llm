import { formatDate, formatNumber } from "@/infrastructure/format-measure";
import { Card } from "@/infrastructure/ui-kit/card";

import { BarList } from "./bar-list";
import {
  type CodeSummary,
  coverageBands,
  coverageSplit,
  formatShare,
  SPARSE_SHARE,
  unitLabel,
  WIDE_SHARE,
} from "./cohort-stats";
import { ColumnChart } from "./column-chart";
import {
  COHORT_ROLES,
  INTRO_PARAGRAPHS,
  INTRO_TITLE,
  NOT_STORED_NOTE,
  SEX_AGE_MISSING,
  SEX_AGE_TITLE,
  sexAgeNote,
  TERMS,
} from "./explorer-copy";
import { type CohortOverview as Overview } from "./explorer-reads";
import { SEX_LABELS, type SexAgeSplit } from "./sex-age-split";
import { SexAgeTable } from "./sex-age-table";

/**
 * The cohort at a glance, after the standalone Synthea viewer prototype, but from
 * what the warehouse actually stores: numeric observations by LOINC code and
 * unit, per subject_ref, and the subjects by stored sex and age band (#4).
 */

const TOP_CODES = 20;

const Section = ({
  title,
  note,
  children,
}: {
  readonly title: string;
  readonly note?: string;
  readonly children: React.ReactNode;
}) => (
  <Card as="section" padding="lg" className="mt-6 min-w-0">
    <h2 className="font-display text-xl">{title}</h2>
    {note && (
      <p className="text-muted-foreground mt-1 max-w-2xl text-sm leading-relaxed">
        {note}
      </p>
    )}
    <div className="mt-4">{children}</div>
  </Card>
);

export const Intro = () => (
  <Card as="section" padding="lg" className="mt-6">
    <h2 className="font-display text-xl">{INTRO_TITLE}</h2>
    {INTRO_PARAGRAPHS.map((text) => (
      <p key={text} className="mt-2 max-w-3xl text-[15px] leading-relaxed">
        {text}
      </p>
    ))}
    <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {TERMS.map(([term, meaning]) => (
        <div key={term} className="bg-muted rounded-lg px-3 py-2.5">
          <dt className="text-sm font-medium">{term}</dt>
          <dd className="text-muted-foreground mt-0.5 text-sm leading-relaxed">
            {meaning}
          </dd>
        </div>
      ))}
    </dl>
    <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
      {NOT_STORED_NOTE}
    </p>
  </Card>
);

const Tile = ({ value, label }: { readonly value: string; readonly label: string }) => (
  <Card padding="md" className="min-w-0">
    <p className="font-mono text-2xl font-bold tabular-nums">{value}</p>
    <p className="text-muted-foreground mt-1 text-sm">{label}</p>
  </Card>
);

const SexAge = ({ split }: { readonly split: SexAgeSplit }) =>
  split.withFacts === 0 ? (
    <Section title={SEX_AGE_TITLE} note={SEX_AGE_MISSING}>
      <SexAgeTable split={split} />
    </Section>
  ) : (
    <Section title={SEX_AGE_TITLE} note={sexAgeNote(split.referenceYear, split.deceased)}>
      <ColumnChart
        label="Subjects per 10-year age band"
        height={180}
        columns={split.bands.map((band) => ({
          id: band.id,
          label: band.from === null ? "n/a" : band.label,
          value: band.total,
          detail: [
            ...split.columns.map(
              (column) =>
                [SEX_LABELS[column], formatNumber(band.counts[column], 0)] as const,
            ),
            ["All", formatNumber(band.total, 0)] as const,
          ],
        }))}
      />
      <p className="text-muted-foreground mt-2 mb-5 text-xs">
        Subjects (y) by age band (x). {formatNumber(split.deceased, 0)} of{" "}
        {formatNumber(split.total, 0)} have a year of death.
      </p>
      <SexAgeTable split={split} />
    </Section>
  );

const codeDetail = (code: CodeSummary, subjects: number) =>
  [
    ["LOINC", code.loinc],
    ["Unit", unitLabel(code.units)],
    ["Subjects", `${formatNumber(code.subjects, 0)} of ${formatNumber(subjects, 0)}`],
    ["Readings", formatNumber(code.rows, 0)],
  ] as const;

const CodeList = ({ codes }: { readonly codes: readonly CodeSummary[] }) =>
  codes.length === 0 ? (
    <p className="text-muted-foreground text-sm">None.</p>
  ) : (
    <ul className="divide-border divide-y text-sm">
      {codes.map((code) => (
        <li key={code.loinc} className="flex justify-between gap-3 py-1.5">
          <span className="min-w-0">
            <span className="block truncate">{code.display}</span>
            <span className="text-muted-foreground font-mono text-xs">
              {code.loinc} · {unitLabel(code.units)}
            </span>
          </span>
          <span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">
            {formatShare(code.share)}
          </span>
        </li>
      ))}
    </ul>
  );

const AllCodes = ({
  codes,
  subjects,
}: {
  readonly codes: readonly CodeSummary[];
  readonly subjects: number;
}) => (
  <details className="mt-4">
    <summary className="text-foreground cursor-pointer text-sm font-medium">
      All {formatNumber(codes.length, 0)} codes
    </summary>
    <div className="relative mt-3 overflow-x-auto">
      <table className="w-full min-w-xl border-collapse text-sm">
        <caption className="sr-only">
          Every numeric LOINC code in the cohort with its units and share of subjects
        </caption>
        <thead>
          <tr className="border-border border-b">
            <th scope="col" className="text-eyebrow px-2 py-2 text-left">
              Code
            </th>
            <th scope="col" className="text-eyebrow px-2 py-2 text-left">
              Name
            </th>
            <th scope="col" className="text-eyebrow px-2 py-2 text-left">
              Unit
            </th>
            <th scope="col" className="text-eyebrow px-2 py-2 text-right">
              Subjects
            </th>
            <th scope="col" className="text-eyebrow px-2 py-2 text-right">
              Readings
            </th>
          </tr>
        </thead>
        <tbody>
          {codes.map((code) => (
            <tr key={code.loinc} className="border-border border-b last:border-b-0">
              <td className="px-2 py-1.5 font-mono text-xs">{code.loinc}</td>
              <td className="px-2 py-1.5">{code.display}</td>
              <td className="px-2 py-1.5 font-mono text-xs">{unitLabel(code.units)}</td>
              <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums">
                {formatNumber(code.subjects, 0)} of {formatNumber(subjects, 0)} (
                {formatShare(code.share)})
              </td>
              <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums">
                {formatNumber(code.rows, 0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </details>
);

export const CohortOverview = ({
  cohortId,
  overview,
}: {
  readonly cohortId: string;
  readonly overview: Overview;
}) => {
  const { totals, codes, years, sexAge } = overview;
  const split = coverageSplit(codes);
  const mixed = codes.filter((code) => code.units.length > 1);
  const perSubject = totals.subjects > 0 ? totals.observations / totals.subjects : null;
  const span =
    totals.firstDay && totals.lastDay
      ? `${totals.firstDay.slice(0, 4)}–${totals.lastDay.slice(0, 4)}`
      : "—";

  return (
    <>
      {COHORT_ROLES[cohortId] && (
        <p className="text-muted-foreground mt-3 text-sm">{COHORT_ROLES[cohortId]}</p>
      )}

      <Intro />

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3">
        <Tile value={formatNumber(totals.subjects, 0)} label="subjects" />
        <Tile value={formatNumber(totals.observations, 0)} label="numeric observations" />
        <Tile
          value={formatNumber(perSubject, 0)}
          label="observations per subject, on average"
        />
        <Tile value={formatNumber(totals.codes, 0)} label="distinct LOINC codes" />
        <Tile
          value={formatNumber(totals.nonNumeric, 0)}
          label="text observations, not charted"
        />
        <Tile
          value={span}
          label={`years covered, ${formatDate(totals.firstDay)} to ${formatDate(totals.lastDay)}`}
        />
      </div>

      <SexAge split={sexAge} />

      <Section
        title="Most common measurements"
        note="Share of subjects with at least one reading of the code. Hover a bar for the code, unit and counts."
      >
        <BarList
          label={`The ${TOP_CODES} LOINC codes the most subjects have, as a share of subjects`}
          items={codes.slice(0, TOP_CODES).map((code) => ({
            id: code.loinc,
            label: code.display,
            fraction: code.share,
            valueText: formatShare(code.share),
            detail: codeDetail(code, totals.subjects),
          }))}
        />
        <AllCodes codes={codes} subjects={totals.subjects} />
      </Section>

      <Section
        title="Observations per year"
        note="Every numeric observation in the cohort by the UTC year it was taken. Synthea simulates whole lives, so the early years hold few records."
      >
        <ColumnChart
          label="Numeric observations per year"
          columns={years.map((year) => ({
            id: String(year.year),
            label: String(year.year),
            value: year.rows,
            detail: [
              ["Observations", formatNumber(year.rows, 0)],
              ["Subjects", formatNumber(year.subjects, 0)],
            ],
          }))}
        />
      </Section>

      <Section
        title="Coverage"
        note="How many codes reach how many subjects. A tool question about a code most subjects have can be answered for most people; a sparse code mostly returns no rows."
      >
        <ColumnChart
          label="Number of LOINC codes by the share of subjects that have them"
          height={180}
          columns={coverageBands(codes).map((band) => ({
            id: String(band.from),
            label: `${band.from}–${band.to}%`,
            value: band.codes,
            detail: [
              ["Codes", formatNumber(band.codes, 0)],
              ["Share of subjects", `${band.from}–${band.to}%`],
            ],
          }))}
        />
        <p className="text-muted-foreground mt-2 text-xs">
          Codes (y) by the share of subjects that have them (x).
        </p>
        <div className="mt-5 grid gap-6 md:grid-cols-2">
          <div className="min-w-0">
            <h3 className="text-sm font-medium">
              In at least {formatShare(WIDE_SHARE)} of subjects (
              {formatNumber(split.wide.length, 0)})
            </h3>
            <div className="mt-2 max-h-72 overflow-y-auto">
              <CodeList codes={split.wide} />
            </div>
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-medium">
              Sparse: under {formatShare(SPARSE_SHARE)} of subjects (
              {formatNumber(split.sparse.length, 0)})
            </h3>
            <div className="mt-2 max-h-72 overflow-y-auto">
              <CodeList codes={split.sparse} />
            </div>
          </div>
        </div>
        {mixed.length > 0 && (
          <p className="text-muted-foreground mt-5 text-sm leading-relaxed">
            Stored in more than one unit. Nothing converts units, so a tool that reads
            both for one subject answers MIXED_UNITS:{" "}
            {mixed.map((code) => `${code.display} (${unitLabel(code.units)})`).join("; ")}
            .
          </p>
        )}
      </Section>
    </>
  );
};
