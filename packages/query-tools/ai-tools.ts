import { tool } from "ai";

import type { WearableSummaries } from "@/infrastructure/offered-keys";

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
  rangePositionInput,
  convertUnitInput,
  sleepSummaryInput,
  hrvTrendInput,
  restingHrTrendInput,
  trainingLoadInput,
} from "./schemas";
import { modelInputSchema } from "./model-schema";
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
  runRangePosition,
  runConvertUnit,
  runSleepSummary,
  runHrvTrend,
  runRestingHrTrend,
  runTrainingLoad,
} from "./tools";
import { NO_WEARABLE_SNAPSHOTS } from "./wearable-readings";

const description = (name: (typeof TOOL_DEFINITIONS)[number]["name"]): string =>
  TOOL_DEFINITIONS.find((definition) => definition.name === name)?.description ?? name;

/**
 * `ports` reaches the analytics tools only (trend, baseline_deviation, coverage,
 * compare_windows, the wearable tools); the B1 reads still use the database
 * directly. Left out, every tool uses its default ports, as before.
 *
 * `wearables` is the snapshots the turn already loaded (none in synthetic
 * mode); only the four wearable tools read them.
 */
export const createQueryTools = (
  scope: SessionScope,
  ports?: QueryToolPorts,
  wearables: WearableSummaries = NO_WEARABLE_SNAPSHOTS,
) => ({
  list_subjects: tool({
    description: description("list_subjects"),
    inputSchema: modelInputSchema(listSubjectsInput),
    execute: async (input) => runListSubjects(scope, input),
  }),
  subject_window: tool({
    description: description("subject_window"),
    inputSchema: modelInputSchema(subjectWindowInput),
    execute: async (input) => runSubjectWindow(scope, input),
  }),
  observations_for_subject: tool({
    description: description("observations_for_subject"),
    inputSchema: modelInputSchema(observationsForSubjectInput),
    execute: async (input) => runObservationsForSubject(scope, input),
  }),
  latest_by_loinc: tool({
    description: description("latest_by_loinc"),
    inputSchema: modelInputSchema(latestByLoincInput),
    execute: async (input) => runLatestByLoinc(scope, input),
  }),
  summary_stats: tool({
    description: description("summary_stats"),
    inputSchema: modelInputSchema(summaryStatsInput),
    execute: async (input) => runSummaryStats(scope, input),
  }),
  trend: tool({
    description: description("trend"),
    inputSchema: modelInputSchema(trendInput),
    execute: async (input) => runTrend(scope, input, ports),
  }),
  baseline_deviation: tool({
    description: description("baseline_deviation"),
    inputSchema: modelInputSchema(baselineDeviationInput),
    execute: async (input) => runBaselineDeviation(scope, input, ports),
  }),
  coverage: tool({
    description: description("coverage"),
    inputSchema: modelInputSchema(coverageInput),
    execute: async (input) => runCoverage(scope, input, ports),
  }),
  compare_windows: tool({
    description: description("compare_windows"),
    inputSchema: modelInputSchema(compareWindowsInput),
    execute: async (input) => runCompareWindows(scope, input, ports),
  }),
  range_position: tool({
    description: description("range_position"),
    inputSchema: modelInputSchema(rangePositionInput),
    execute: async (input) => runRangePosition(scope, input, ports),
  }),
  convert_unit: tool({
    description: description("convert_unit"),
    inputSchema: modelInputSchema(convertUnitInput),
    execute: async (input) => runConvertUnit(scope, input, ports),
  }),
  sleep_summary: tool({
    description: description("sleep_summary"),
    inputSchema: modelInputSchema(sleepSummaryInput),
    execute: async (input) => runSleepSummary(scope, input, ports, wearables),
  }),
  hrv_trend: tool({
    description: description("hrv_trend"),
    inputSchema: modelInputSchema(hrvTrendInput),
    execute: async (input) => runHrvTrend(scope, input, ports, wearables),
  }),
  resting_hr_trend: tool({
    description: description("resting_hr_trend"),
    inputSchema: modelInputSchema(restingHrTrendInput),
    execute: async (input) => runRestingHrTrend(scope, input, ports, wearables),
  }),
  training_load: tool({
    description: description("training_load"),
    inputSchema: modelInputSchema(trainingLoadInput),
    execute: async (input) => runTrainingLoad(scope, input, ports, wearables),
  }),
});
