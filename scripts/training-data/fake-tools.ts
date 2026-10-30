/**
 * Test helper: the real analytics tools and `convert_unit` over in-memory rows, plus in-memory
 * `latest_by_loinc` and `subject_window` (those two read the database
 * directly). Used by the training-data tests only.
 */
import type { ObservationRecord, QueryToolPorts } from "../../packages/query-tools/ports";
import { noReadingForCodes } from "../../packages/query-tools/refusals";
import { SUBJECT_SCOPE_VIOLATION } from "../../packages/query-tools/scope";
import { readFileSync } from "node:fs";

import { guidelineSearchInput } from "../../packages/guidelines/input";
import {
  runBaselineDeviation,
  runCompareWindows,
  runConvertUnit,
  runCoverage,
  runHrvTrend,
  runRestingHrTrend,
  runSleepSummary,
  runTrainingLoad,
  runTrend,
} from "../../packages/query-tools/tools";
import { KEYED_TOOLS } from "../evaluation/question-set";
import {
  DEFAULT_DAYS,
  DEFAULT_END_DAY,
  DAILY_METRICS,
  generateSeries,
} from "../synthetic-wearables/series";
import { generateWorkouts, WORKOUT_METRICS } from "../synthetic-wearables/workouts";

import { CATALOGUE_FILE, catalogueChunks, searchCatalogue } from "./knowledge-notes";

import type { ToolName } from "./families";

export const FAKE_COHORT = "synthea-v4-seed4242";

export type FakeRows = Readonly<Record<string, readonly ObservationRecord[]>>;

export const fakeTools = (data: FakeRows) => {
  const calls: Array<{ name: ToolName; args: unknown }> = [];
  const ports: QueryToolPorts = {
    findSubject: async (ref) =>
      ref in data ? { isSynthetic: true, cohortId: FAKE_COHORT } : null,
    findObservations: async (query) =>
      (data[query.subjectRef] ?? [])
        .filter(
          (row) =>
            query.loinc.includes(row.loinc) &&
            row.effectiveAt >= query.start &&
            row.effectiveAt <= query.end,
        )
        .toSorted((a, b) => a.effectiveAt.getTime() - b.effectiveAt.getTime())
        .slice(0, query.take),
    findCohortObservations: async () => [],
    appendAudit: async () => undefined,
  };
  const scope = { actor: "test", sessionId: "test", mode: "synthetic" } as const;
  const run = async (name: ToolName, args: unknown): Promise<unknown> => {
    calls.push({ name, args });
    const rows = (ref: string) => [...(data[ref] ?? [])];
    switch (name) {
      case "trend":
        return runTrend(scope, KEYED_TOOLS.trend.parse(args), ports);
      case "baseline_deviation":
        return runBaselineDeviation(
          scope,
          KEYED_TOOLS.baseline_deviation.parse(args),
          ports,
        );
      case "coverage":
        return runCoverage(scope, KEYED_TOOLS.coverage.parse(args), ports);
      case "compare_windows":
        return runCompareWindows(scope, KEYED_TOOLS.compare_windows.parse(args), ports);
      case "convert_unit":
        return runConvertUnit(scope, KEYED_TOOLS.convert_unit.parse(args), ports);
      case "sleep_summary":
        return runSleepSummary(scope, KEYED_TOOLS.sleep_summary.parse(args), ports);
      case "hrv_trend":
        return runHrvTrend(scope, KEYED_TOOLS.hrv_trend.parse(args), ports);
      case "resting_hr_trend":
        return runRestingHrTrend(scope, KEYED_TOOLS.resting_hr_trend.parse(args), ports);
      case "training_load":
        return runTrainingLoad(scope, KEYED_TOOLS.training_load.parse(args), ports);
      case "knowledge_search":
        return searchCatalogue(catalogue(), guidelineSearchInput.parse(args));
      case "latest_by_loinc": {
        const input = KEYED_TOOLS.latest_by_loinc.parse(args);
        if (!(input.subject_ref in data)) return SUBJECT_SCOPE_VIOLATION;
        const latest = input.loinc.flatMap((loinc) => {
          const own = rows(input.subject_ref)
            .filter((row) => row.loinc === loinc)
            .toSorted((a, b) => b.effectiveAt.getTime() - a.effectiveAt.getTime());
          const row = own[0];
          return row
            ? [
                {
                  subject_ref: input.subject_ref,
                  loinc,
                  display: loinc,
                  value: row.value,
                  unit_ucum: row.unitUcum,
                  effective_at: row.effectiveAt.toISOString(),
                },
              ]
            : [];
        });
        if (latest.length === 0) return noReadingForCodes(input.loinc);
        return {
          rows: latest,
          codes_without_rows: input.loinc.filter(
            (code) => !latest.some((row) => row.loinc === code),
          ),
        };
      }
      case "subject_window": {
        const ref = String(Reflect.get(Object(args), "subject_ref"));
        if (!(ref in data)) return SUBJECT_SCOPE_VIOLATION;
        const times = rows(ref).map((row) => row.effectiveAt.getTime());
        return times.length === 0
          ? { start: null, end: null, n_observations: 0 }
          : {
              start: new Date(Math.min(...times)).toISOString(),
              end: new Date(Math.max(...times)).toISOString(),
              n_observations: times.length,
            };
      }
    }
  };
  return { run, calls };
};

const at = (iso: string) => new Date(iso);

/** Two subjects: daily resting heart rate for 90 days and yearly HbA1c; s-b has urine specific gravity in two units. */
export const sampleRows = (): FakeRows => {
  const days = Array.from(
    { length: 90 },
    (_, index) => new Date(Date.parse("2026-07-04T07:00:00Z") + index * 86_400_000),
  );
  const resting = days
    .filter((_, index) => index % 10 !== 3)
    .map((day, index) => ({
      loinc: "40443-4",
      value: 58 + (index % 5) + (index >= 70 ? 6 : 0),
      unitUcum: "/min",
      effectiveAt: day,
    }));
  const hba1c = [5.4, 5.5, 5.7, 5.8, 6.0, 6.1].map((value, index) => ({
    loinc: "4548-4",
    value,
    unitUcum: "%",
    effectiveAt: at(`${2021 + index}-03-15T09:00:00Z`),
  }));
  // Urine specific gravity in two units, as Synthea v4 writes it.
  const gravity = [
    {
      loinc: "5811-5",
      value: 1.02,
      unitUcum: "{nominal}",
      effectiveAt: at("2023-05-01T09:00:00Z"),
    },
    {
      loinc: "5811-5",
      value: 1.01,
      unitUcum: "{SG}",
      effectiveAt: at("2025-05-01T09:00:00Z"),
    },
  ];
  return { "s-a": [...resting, ...hba1c], "s-b": [...hba1c, ...gravity] };
};

let chunks: ReturnType<typeof catalogueChunks> | null = null;

/** The shipped biomarker catalogue's chunks, read once. */
const catalogue = () => {
  chunks ??= catalogueChunks(
    readFileSync(
      new URL(`../../knowledge/opentwin/${CATALOGUE_FILE}`, import.meta.url),
      "utf8",
    ),
  );
  return chunks;
};

/**
 * One subject's synthetic wearable series and workouts as warehouse rows,
 * made by the real generator (`scripts/synthetic-wearables`) the way
 * `wearables:generate` writes them: 90 days to 1 Oct 2026, each metric at its
 * own time of day.
 */
export const generatedWearableRows = (
  seed: number,
  subjectRef: string,
): readonly ObservationRecord[] => {
  const options = { seed, subjectRef, endDay: DEFAULT_END_DAY, days: DEFAULT_DAYS };
  const series = generateSeries(options);
  const daily = series.map((reading) => {
    const metric = DAILY_METRICS[reading.metric];
    return {
      loinc: metric.code,
      value: reading.value,
      unitUcum: metric.unit,
      effectiveAt: new Date(`${reading.day}T${metric.time}Z`),
    };
  });
  const workouts = generateWorkouts(options, series).map((reading) => {
    const metric = WORKOUT_METRICS[reading.metric];
    return {
      loinc: metric.code,
      value: reading.value,
      unitUcum: metric.unit,
      effectiveAt: new Date(`${reading.day}T${metric.time}Z`),
    };
  });
  return [...daily, ...workouts];
};
