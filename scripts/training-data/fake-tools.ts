/**
 * Test helper: the real analytics tools and `convert_unit` over in-memory rows, plus in-memory
 * `latest_by_loinc` and `subject_window` (those two read the database
 * directly). Used by the training-data tests only.
 */
import type { ObservationRecord, QueryToolPorts } from "../../packages/query-tools/ports";
import { SUBJECT_SCOPE_VIOLATION } from "../../packages/query-tools/scope";
import {
  runBaselineDeviation,
  runCompareWindows,
  runConvertUnit,
  runCoverage,
  runTrend,
} from "../../packages/query-tools/tools";
import { KEYED_TOOLS } from "../evaluation/question-set";

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
        return { rows: latest };
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
