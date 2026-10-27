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
  rangePositionInput,
  convertUnitInput,
  cohortPositionInput,
  conditionsTimelineInput,
  medicationsTimelineInput,
  valuesAroundEventInput,
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
  runCohortPosition,
  runConditionsTimeline,
  runMedicationsTimeline,
  runValuesAroundEvent,
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
  cohort_position: tool({
    description: description("cohort_position"),
    inputSchema: modelInputSchema(cohortPositionInput),
    execute: async (input) => runCohortPosition(scope, input, ports),
  }),
  conditions_timeline: tool({
    description: description("conditions_timeline"),
    inputSchema: modelInputSchema(conditionsTimelineInput),
    execute: async (input) => runConditionsTimeline(scope, input, ports),
  }),
  medications_timeline: tool({
    description: description("medications_timeline"),
    inputSchema: modelInputSchema(medicationsTimelineInput),
    execute: async (input) => runMedicationsTimeline(scope, input, ports),
  }),
  values_around_event: tool({
    description: description("values_around_event"),
    inputSchema: modelInputSchema(valuesAroundEventInput),
    execute: async (input) => runValuesAroundEvent(scope, input, ports),
  }),
});
