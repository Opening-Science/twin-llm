import { tool } from "ai";

import {
  baselineDeviationInput,
  compareWindowsInput,
  coverageInput,
  latestByLoincInput,
  listSubjectsInput,
  observationsForSubjectInput,
  subjectWindowInput,
  summaryStatsInput,
  TOOL_DEFINITIONS,
  trendInput,
} from "./schemas";
import type { QueryToolPorts } from "./ports";
import type { SessionScope } from "./scope";
import {
  runBaselineDeviation,
  runCompareWindows,
  runCoverage,
  runLatestByLoinc,
  runListSubjects,
  runObservationsForSubject,
  runSubjectWindow,
  runSummaryStats,
  runTrend,
} from "./tools";

const description = (name: (typeof TOOL_DEFINITIONS)[number]["name"]): string =>
  TOOL_DEFINITIONS.find((definition) => definition.name === name)?.description ?? name;

/**
 * `ports` reaches the analytics tools only (trend, baseline_deviation, coverage,
 * compare_windows); the B1 reads still use the database directly. Left out,
 * every tool uses its default ports, as before.
 */
export const createQueryTools = (scope: SessionScope, ports?: QueryToolPorts) => ({
  list_subjects: tool({
    description: description("list_subjects"),
    inputSchema: listSubjectsInput,
    execute: async (input) => runListSubjects(scope, input),
  }),
  subject_window: tool({
    description: description("subject_window"),
    inputSchema: subjectWindowInput,
    execute: async (input) => runSubjectWindow(scope, input),
  }),
  observations_for_subject: tool({
    description: description("observations_for_subject"),
    inputSchema: observationsForSubjectInput,
    execute: async (input) => runObservationsForSubject(scope, input),
  }),
  latest_by_loinc: tool({
    description: description("latest_by_loinc"),
    inputSchema: latestByLoincInput,
    execute: async (input) => runLatestByLoinc(scope, input),
  }),
  summary_stats: tool({
    description: description("summary_stats"),
    inputSchema: summaryStatsInput,
    execute: async (input) => runSummaryStats(scope, input),
  }),
  trend: tool({
    description: description("trend"),
    inputSchema: trendInput,
    execute: async (input) => runTrend(scope, input, ports),
  }),
  baseline_deviation: tool({
    description: description("baseline_deviation"),
    inputSchema: baselineDeviationInput,
    execute: async (input) => runBaselineDeviation(scope, input, ports),
  }),
  coverage: tool({
    description: description("coverage"),
    inputSchema: coverageInput,
    execute: async (input) => runCoverage(scope, input, ports),
  }),
  compare_windows: tool({
    description: description("compare_windows"),
    inputSchema: compareWindowsInput,
    execute: async (input) => runCompareWindows(scope, input, ports),
  }),
});
