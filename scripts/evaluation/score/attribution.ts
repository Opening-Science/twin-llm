/**
 * Source attribution and retrieval for the wearable numbers of an answer
 * (#508): does each number trace to the right source and day, and did the turn
 * fetch the rows the item needs. Reported beside the eight criteria; no pass
 * or fail of theirs depends on it. Pure, no model calls.
 *
 * Inputs, all from the results line and the item:
 * - **Rows fetched**: every object in the turn's tool results with a stored
 *   metric `key` and a numeric `value`. Its source is its own `source` field,
 *   else the key's vendor prefix (`sourceOfMetricKey`); its day is its `date`,
 *   else the day the key ends with (`metricDay`); its measure is the one the
 *   source rules compare (`COMPARABLE_STEMS`), or none.
 * - **Source decisions**: the `wearable.sources.*` audit row's decisions
 *   (`audit[].source_decisions`), each with its measure and day. A row's
 *   decision is the one for its measure and day; their order never matters.
 *   They are used only when, without their days, they hash to the audit
 *   row's `args_sha256` (`verifiedSourceDecisions`); else every number is
 *   labelled without them and `verified` is false. Two decisions for one
 *   measure and day that differ are both left out.
 * - **Rows needed**: `expect.wearable_rows`, stored keys.
 *
 * A wearable number is the number `checkCitedValues` reads as stated for a
 * measure, clause by clause (up to `.`, `;`, `!`, `?` or a line end), so one
 * clause gives at most one number per measure. Its named source is the
 * vendor written after it with `from`, `by`, `on`, `per`, `via`, `according
 * to` or `(` (`52 ms from WHOOP`), else the nearest one written before it
 * (`WHOOP's HRV was 52 ms`), within the stretch between the numbers next to
 * it. A clause that writes a date names a day: only rows of that day count.
 *
 * Each number gets one label, the first that holds:
 * - `stated_withheld`: it matches a reading of a measure and day the rules
 *   held back, or it matches none and every day of its measure in view was
 *   held back. The rules hold a value back so that no answer states it.
 * - `correct`: it matches a reading of the source it names.
 * - `unnamed`: it names no source and matches the reading the app shows (the
 *   only source that day, or the rules' choice): the right reading, but the
 *   answer leaves the source to the app's chip.
 * - `misattributed`: it matches a reading, but of another source than the
 *   one named, or (none named) not the reading the app shows.
 * - `unsourced`: it matches no reading in view.
 *
 * Retrieval: recall is the needed rows fetched over the rows needed;
 * precision is the needed rows fetched over the wearable rows fetched.
 */
import { checkCitedValues } from "../../../infrastructure/cited-value-check";
import { formatDate, metricStem } from "../../../infrastructure/format-measure";
import { DATE_PATTERN } from "../../../infrastructure/narrated-numbers";
import { answerNumbers } from "../../../infrastructure/number-sources";
import {
  isWearableSourceId,
  metricDay,
  sourceOfMetricKey,
  type WearableSourceId,
} from "../../../infrastructure/wearable-provenance";
import {
  COMPARABLE_STEMS,
  SOURCE_MEASURES,
  SOURCE_UNITS,
  type SourceDecisionKind,
  type SourceMeasure,
} from "../../../infrastructure/wearable-source-rules";

import {
  type ResultLine,
  type SourceDecisions,
  verifiedSourceDecisions,
} from "../eval-results";
import type { Question } from "../question-set";

import type { AnsweredLine } from "./types";

export const ATTRIBUTION_LABELS = [
  "correct",
  "unnamed",
  "misattributed",
  "stated_withheld",
  "unsourced",
] as const;

export type AttributionLabel = (typeof ATTRIBUTION_LABELS)[number];

/** One wearable reading a tool returned. */
export type WearableRow = Readonly<{
  key: string;
  source: WearableSourceId;
  day: string | null;
  /** Null for a measure the source rules do not compare. */
  measure: SourceMeasure | null;
  value: number;
  unit: string | null;
}>;

/** A decision placed on its measure and day. */
export type OccasionDecision = Readonly<{
  outcome: SourceDecisionKind;
  used: WearableSourceId | null;
}>;

export type LabelledNumber = Readonly<{
  /** As the answer wrote it, unit included. */
  stated: string;
  measure: SourceMeasure;
  /** The source the answer names for it; null when it names none. */
  named: WearableSourceId | null;
  label: AttributionLabel;
  /** The reading it traces to; null when it matches none. */
  key: string | null;
}>;

export type Retrieval = Readonly<{
  needed: number;
  fetched: number;
  hits: number;
  /** Hits over needed; null when nothing is needed. */
  recall: number | null;
  /** Hits over fetched; null when nothing was fetched. */
  precision: number | null;
}>;

export type AttributionScore = Readonly<{
  /** The rule set the decisions came from; null when the turn recorded none. */
  rules: string | null;
  /** The turn recorded decisions and they hash to its audit row. */
  verified: boolean;
  numbers: readonly LabelledNumber[];
  counts: Readonly<Record<AttributionLabel, number>>;
  /** Null when the item lists no `wearable_rows`. */
  retrieval: Retrieval | null;
}>;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** `google` is the wearable tools' name for Google Health (`wearable-readings.ts`). */
const rowSource = (source: unknown, key: string): WearableSourceId =>
  isWearableSourceId(source)
    ? source
    : source === "google"
      ? "google_health"
      : sourceOfMetricKey(key);

const measureOf = (key: string): SourceMeasure | null =>
  COMPARABLE_STEMS[metricStem(key).replace(/\.unknown$/, "")] ?? null;

const rowOf = (record: Readonly<Record<string, unknown>>): WearableRow | null => {
  const { key, value, unit, date, source } = record;
  if (typeof key !== "string" || typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return {
    key,
    source: rowSource(source, key),
    day: metricDay({ key, ...(typeof date === "string" ? { date } : {}) }),
    measure: measureOf(key),
    value,
    unit: typeof unit === "string" ? unit : null,
  };
};

const rowsIn = (value: unknown): readonly WearableRow[] => {
  if (Array.isArray(value)) return value.flatMap(rowsIn);
  if (!isRecord(value)) return [];
  const own = rowOf(value);
  return own === null ? Object.values(value).flatMap(rowsIn) : [own];
};

/** Every wearable row the turn's tools returned, once per key, in order. */
export const fetchedRows = (
  toolResults: ResultLine["tool_results"],
): readonly WearableRow[] => {
  const seen = new Set<string>();
  return toolResults
    .flatMap((result) => rowsIn(result.output))
    .filter((row) => {
      if (seen.has(row.key)) return false;
      seen.add(row.key);
      return true;
    });
};

/**
 * The decisions the line keeps for its `wearable.sources.*` row and whether
 * they hash to it; null when the turn has no such row with decisions.
 */
export const recordedDecisions = (
  audit: ResultLine["audit"],
): Readonly<{ recorded: SourceDecisions; verified: boolean }> | null => {
  const row = audit.find((line) => line.source_decisions !== undefined);
  if (row?.source_decisions === undefined) return null;
  return {
    recorded: row.source_decisions,
    verified: verifiedSourceDecisions(row) !== null,
  };
};

const occasionId = (measure: SourceMeasure, day: string | null): string =>
  `${measure}|${day ?? ""}`;

/**
 * Each decision by its measure and day. Where two for one measure and day
 * differ, neither is kept: the line cannot say which the turn used.
 */
export const placeDecisions = (
  decisions: SourceDecisions["decisions"],
): ReadonlyMap<string, OccasionDecision> => {
  const placed = new Map<string, OccasionDecision>();
  const clashing = new Set<string>();
  for (const decision of decisions) {
    const id = occasionId(decision.measure, decision.day);
    const held = placed.get(id);
    if (
      held !== undefined &&
      (held.outcome !== decision.outcome || held.used !== decision.used)
    ) {
      clashing.add(id);
    }
    placed.set(id, { outcome: decision.outcome, used: decision.used });
  }
  for (const id of clashing) placed.delete(id);
  return placed;
};

/** Ways an answer names each measure; `checkCitedValues` reads its label aliases. */
const MEASURE_NAMES: Readonly<Record<SourceMeasure, readonly string[]>> = {
  "heart-rate-variability": ["HRV", "heart rate variability"],
  "resting-heart-rate": ["resting heart rate", "resting HR", "RHR"],
  "oxygen-saturation": ["blood oxygen", "oxygen saturation", "SpO2"],
  "step-count": ["steps", "step count"],
};

const VENDORS: readonly Readonly<{ source: WearableSourceId; pattern: RegExp }>[] = [
  { source: "oura", pattern: /\boura\b/gi },
  { source: "whoop", pattern: /\bwhoop\b/gi },
  { source: "google_health", pattern: /\bgoogle(?: health)?\b/gi },
  { source: "bodyloop", pattern: /\bbodyloop\b/gi },
];

/** A vendor written after a number names its source only after one of these. */
const SOURCE_AFTER = /(?:\bfrom|\bby|\bon|\bper|\bvia|\baccording to|\()\s*$/i;

type Named = Readonly<{ source: WearableSourceId; start: number }>;

const vendorsIn = (text: string): readonly Named[] =>
  VENDORS.flatMap(({ source, pattern }) =>
    [...text.matchAll(pattern)].map((match) => ({ source, start: match.index ?? 0 })),
  ).sort((a, b) => a.start - b.start);

/** The vendor the clause names for the number at `start`–`end`, or null. */
const namedSource = (
  clause: string,
  start: number,
  end: number,
): WearableSourceId | null => {
  const numbers = answerNumbers(clause);
  const before = Math.max(0, ...numbers.filter((n) => n.end <= start).map((n) => n.end));
  const after = Math.min(
    clause.length,
    ...numbers.filter((n) => n.start >= end).map((n) => n.start),
  );
  const vendors = vendorsIn(clause);
  const following = vendors.find(
    (vendor) =>
      vendor.start >= end &&
      vendor.start < after &&
      SOURCE_AFTER.test(clause.slice(end, vendor.start)),
  );
  if (following !== undefined) return following.source;
  const preceding = vendors.filter(
    (vendor) => vendor.start >= before && vendor.start < start,
  );
  return preceding.at(-1)?.source ?? null;
};

const CLAUSE_END = /[.!?](?=\s|$)|[;\n]/;

const clausesOf = (text: string): readonly string[] =>
  text.split(CLAUSE_END).filter((clause) => clause.trim() !== "");

const dayWritten = (clause: string, day: string | null): boolean =>
  day !== null &&
  [day, formatDate(day), formatDate(day, "short")].some((form) => clause.includes(form));

const namesADay = (clause: string): boolean =>
  new RegExp(DATE_PATTERN.source).test(clause);

const defaultUnit = (measure: SourceMeasure): string => SOURCE_UNITS[measure][0] ?? "";

/** A reading no stated number can match, to find what a clause states for a measure. */
const PROBE_VALUE = -1e9;

/** A row of a measure the source rules compare. */
type Compared = WearableRow & Readonly<{ measure: SourceMeasure }>;

type Claim = Readonly<{ stated: string; at: number; matched: readonly Compared[] }>;

/** The number each mention of `measure` in `clause` states, and the rows it matches. */
const claimsIn = (
  clause: string,
  measure: SourceMeasure,
  rows: readonly Compared[],
): readonly Claim[] => {
  const unit = defaultUnit(measure);
  const statedFor = (key: string, value: number, rowUnit: string | null) =>
    MEASURE_NAMES[measure].flatMap((label) => {
      const [check] = checkCitedValues(clause, [
        { key, label, value, unit: rowUnit ?? unit },
      ]);
      return check?.stated === undefined
        ? []
        : [{ status: check.status, stated: check.stated }];
    });
  const stated = [
    ...new Set(statedFor("probe", PROBE_VALUE, unit).map((found) => found.stated)),
  ];
  return stated.map((text) => ({
    stated: text,
    at: clause.indexOf(text),
    matched: rows.filter((row) =>
      statedFor(row.key, row.value, row.unit).some(
        (found) => found.status === "matched" && found.stated === text,
      ),
    ),
  }));
};

const isShown = (
  row: WearableRow,
  decision: OccasionDecision | undefined,
  onDay: number,
) => (decision === undefined ? onDay === 1 : decision.used === row.source);

/** Every wearable number of `text` with its label. */
export const labelNumbers = (
  text: string,
  rows: readonly WearableRow[],
  placed: ReadonlyMap<string, OccasionDecision>,
): readonly LabelledNumber[] => {
  const comparable = rows.filter((row): row is Compared => row.measure !== null);
  const decisionOf = (row: Compared) => placed.get(occasionId(row.measure, row.day));
  const sourcesOn = (row: Compared) =>
    new Set(
      comparable
        .filter((other) => other.measure === row.measure && other.day === row.day)
        .map((other) => other.source),
    ).size;
  const heldBack = (row: Compared) => decisionOf(row)?.outcome === "held_back";

  return clausesOf(text).flatMap((clause) =>
    SOURCE_MEASURES.flatMap((measure) => {
      const ofMeasure = comparable.filter((row) => row.measure === measure);
      if (ofMeasure.length === 0) return [];
      const dated = namesADay(clause);
      const inView = dated
        ? ofMeasure.filter((row) => dayWritten(clause, row.day))
        : ofMeasure;
      return claimsIn(clause, measure, inView).map((claim): LabelledNumber => {
        const named =
          claim.at === -1
            ? null
            : namedSource(clause, claim.at, claim.at + claim.stated.length);
        const base = { stated: claim.stated, measure, named };
        const withheld = claim.matched.find(heldBack);
        if (withheld !== undefined) {
          return { ...base, label: "stated_withheld", key: withheld.key };
        }
        if (claim.matched.length === 0) {
          const allHeld = inView.length > 0 && inView.every(heldBack);
          return { ...base, label: allHeld ? "stated_withheld" : "unsourced", key: null };
        }
        const right = claim.matched.find((row) =>
          named === null
            ? isShown(row, decisionOf(row), sourcesOn(row))
            : row.source === named,
        );
        if (right === undefined) {
          return { ...base, label: "misattributed", key: claim.matched[0]?.key ?? null };
        }
        return { ...base, label: named === null ? "unnamed" : "correct", key: right.key };
      });
    }),
  );
};

/** Recall and precision of the rows fetched against the rows needed. */
export const retrievalOf = (
  fetched: readonly string[],
  needed: readonly string[],
): Retrieval => {
  const got = new Set(fetched);
  const want = new Set(needed);
  const hits = [...want].filter((key) => got.has(key)).length;
  return {
    needed: want.size,
    fetched: got.size,
    hits,
    recall: want.size === 0 ? null : hits / want.size,
    precision: got.size === 0 ? null : hits / got.size,
  };
};

const countLabels = (
  numbers: readonly LabelledNumber[],
): Readonly<Record<AttributionLabel, number>> =>
  Object.fromEntries(
    ATTRIBUTION_LABELS.map((label) => [
      label,
      numbers.filter((number) => number.label === label).length,
    ]),
  ) as Record<AttributionLabel, number>;

/** The score from its parts; `scoreAttribution` reads them off a results line. */
export const attributionScore = (
  input: Readonly<{
    text: string;
    rows: readonly WearableRow[];
    /** The decisions the line keeps; scored only when `verified`. */
    decisions: SourceDecisions | null;
    verified: boolean;
    needed: readonly string[] | null;
  }>,
): AttributionScore => {
  const used = input.verified ? (input.decisions?.decisions ?? []) : [];
  const numbers = labelNumbers(input.text, input.rows, placeDecisions(used));
  return {
    rules: input.decisions?.rules ?? null,
    verified: input.decisions !== null && input.verified,
    numbers,
    counts: countLabels(numbers),
    retrieval:
      input.needed === null
        ? null
        : retrievalOf(
            input.rows.map((row) => row.key),
            input.needed,
          ),
  };
};

/**
 * Null when the item needs no wearable rows and the turn fetched none it could
 * compare: there is nothing to attribute.
 */
export const scoreAttribution = (
  input: Readonly<{ item: Question; line: AnsweredLine }>,
): AttributionScore | null => {
  const rows = fetchedRows(input.line.tool_results);
  const needed = input.item.expect.wearable_rows ?? null;
  if (needed === null && !rows.some((row) => row.measure !== null)) return null;
  const recorded = recordedDecisions(input.line.audit);
  return attributionScore({
    text: input.line.answer_text ?? input.line.text ?? "",
    rows,
    decisions: recorded?.recorded ?? null,
    verified: recorded?.verified ?? false,
    needed,
  });
};
