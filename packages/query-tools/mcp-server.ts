import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  type DataMode,
  IMPORTED_DATA_NOT_PERMITTED,
  type ImportedDataPermitDecision,
  permitImportedDataStore,
} from "@/infrastructure/data-mode-policy";

import { IMPORTED_TOOLS, type ImportedToolName } from "./imported-names";
import {
  importedDatasetsInput,
  importedLatestInput,
  importedTrendInput,
} from "./imported-schemas";
import {
  type ImportedToolDeps,
  runImportedDatasets,
  runImportedLatest,
  runImportedTrend,
} from "./imported-tools";
import { mcpToolManifest } from "./manifests";
import type { QueryToolPorts } from "./ports";
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
  sleepSummaryInput,
  hrvTrendInput,
  restingHrTrendInput,
  trainingLoadInput,
  crossSourceCompareInput,
  valuesAroundEventInput,
  rhythmIrregularityInput,
} from "./schemas";
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
  runSleepSummary,
  runHrvTrend,
  runRestingHrTrend,
  runTrainingLoad,
  runCrossSourceCompare,
  runValuesAroundEvent,
  runRhythmIrregularity,
} from "./tools";

/**
 * The query tools as an MCP server. The tool list is the committed
 * manifest; each call is parsed with the tool's zod schema and runs the same
 * function chat runs, so scope and audit rules are unchanged. `scripts/
 * mcp-server.ts` connects it to stdio; nothing here opens a database.
 */

export type McpTransport = "stdio" | "streamable-http" | "sse";

export const TRANSPORT_NOT_PERMITTED_ERROR =
  "TRANSPORT_NOT_PERMITTED_FOR_DATA_MODE: DATA_MODE=personal serves the query tools over stdio only; a network transport may not carry personal data.";

/** Personal data stays on this machine: a personal-mode server listens on stdio or not at all. */
export const assertTransportAllowedForDataMode = (
  mode: DataMode,
  transport: McpTransport,
): void => {
  if (mode === "personal" && transport !== "stdio") {
    throw new Error(TRANSPORT_NOT_PERMITTED_ERROR);
  }
};

export type QueryToolName = (typeof TOOL_DEFINITIONS)[number]["name"] | ImportedToolName;

export type QueryToolRunner = (args: unknown) => Promise<unknown>;

export type QueryToolRunners = Readonly<Record<QueryToolName, QueryToolRunner>>;

const bind =
  <Input>(
    schema: z.ZodType<Input>,
    run: (input: Input) => Promise<unknown>,
  ): QueryToolRunner =>
  (args) =>
    run(schema.parse(args));

/**
 * An MCP client's model is not known to run on this machine, so imported data is never read here: synthetic mode refuses as
 * not personal, personal mode as not local.
 */
export const mcpImportedPermit = (mode: DataMode): ImportedDataPermitDecision => {
  const stored = permitImportedDataStore(mode);
  return stored.ok
    ? { ok: false, code: IMPORTED_DATA_NOT_PERMITTED, reason: "chat-model-not-local" }
    : stored;
};

const NOTHING_TO_READ = async () => [];

/** The imported-data tools as MCP serves them: the policy refuses before any read. */
const mcpImportedDeps = (
  scope: SessionScope,
  ports: QueryToolPorts,
): ImportedToolDeps => ({
  scope,
  permit: () => mcpImportedPermit(scope.mode),
  ports: {
    listDatasets: NOTHING_TO_READ,
    listSeries: NOTHING_TO_READ,
    findLatest: NOTHING_TO_READ,
    findSeries: NOTHING_TO_READ,
    appendAudit: ports.appendAudit,
  },
});

/** The real tools, bound to one scope. `ports` carries the audit appender. */
export const queryToolRunners = (
  scope: SessionScope,
  ports: QueryToolPorts,
): QueryToolRunners => ({
  list_subjects: bind(listSubjectsInput, (input) => runListSubjects(scope, input)),
  subject_window: bind(subjectWindowInput, (input) => runSubjectWindow(scope, input)),
  observations_for_subject: bind(observationsForSubjectInput, (input) =>
    runObservationsForSubject(scope, input),
  ),
  latest_by_loinc: bind(latestByLoincInput, (input) => runLatestByLoinc(scope, input)),
  summary_stats: bind(summaryStatsInput, (input) => runSummaryStats(scope, input)),
  trend: bind(trendInput, (input) => runTrend(scope, input, ports)),
  baseline_deviation: bind(baselineDeviationInput, (input) =>
    runBaselineDeviation(scope, input, ports),
  ),
  coverage: bind(coverageInput, (input) => runCoverage(scope, input, ports)),
  compare_windows: bind(compareWindowsInput, (input) =>
    runCompareWindows(scope, input, ports),
  ),
  range_position: bind(rangePositionInput, (input) =>
    runRangePosition(scope, input, ports),
  ),
  convert_unit: bind(convertUnitInput, (input) => runConvertUnit(scope, input, ports)),
  cohort_position: bind(cohortPositionInput, (input) =>
    runCohortPosition(scope, input, ports),
  ),
  conditions_timeline: bind(conditionsTimelineInput, (input) =>
    runConditionsTimeline(scope, input, ports),
  ),
  medications_timeline: bind(medicationsTimelineInput, (input) =>
    runMedicationsTimeline(scope, input, ports),
  ),
  sleep_summary: bind(sleepSummaryInput, (input) => runSleepSummary(scope, input, ports)),
  hrv_trend: bind(hrvTrendInput, (input) => runHrvTrend(scope, input, ports)),
  resting_hr_trend: bind(restingHrTrendInput, (input) =>
    runRestingHrTrend(scope, input, ports),
  ),
  training_load: bind(trainingLoadInput, (input) => runTrainingLoad(scope, input, ports)),
  cross_source_compare: bind(crossSourceCompareInput, (input) =>
    runCrossSourceCompare(scope, input, ports),
  ),
  values_around_event: bind(valuesAroundEventInput, (input) =>
    runValuesAroundEvent(scope, input, ports),
  ),
  imported_datasets: bind(importedDatasetsInput, (input) =>
    runImportedDatasets(mcpImportedDeps(scope, ports), input),
  ),
  imported_latest: bind(importedLatestInput, (input) =>
    runImportedLatest(mcpImportedDeps(scope, ports), input),
  ),
  imported_trend: bind(importedTrendInput, (input) =>
    runImportedTrend(mcpImportedDeps(scope, ports), input),
  ),
  rhythm_irregularity: bind(rhythmIrregularityInput, (input) =>
    runRhythmIrregularity(scope, input, ports),
  ),
});

export const QUERY_MCP_SERVER_INFO = {
  name: "twinllm-query-tools",
  version: "0.1.0",
} as const;

const isQueryToolName = (name: string): name is QueryToolName =>
  TOOL_DEFINITIONS.some((definition) => definition.name === name) ||
  (IMPORTED_TOOLS as readonly string[]).includes(name);

const errorResult = (text: string): CallToolResult => ({
  isError: true,
  content: [{ type: "text", text }],
});

export const createQueryMcpServer = (runners: QueryToolRunners): Server => {
  const server = new Server(QUERY_MCP_SERVER_INFO, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => mcpToolManifest());

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;
    if (!isQueryToolName(name)) {
      throw new McpError(ErrorCode.InvalidParams, `unknown tool: ${name}`);
    }
    try {
      const result = await runners[name](request.params.arguments ?? {});
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return errorResult(`invalid arguments: ${z.prettifyError(error)}`);
      }
      console.error(`[mcp] ${name} failed`, error instanceof Error ? error.name : "");
      return errorResult("query tool failed");
    }
  });

  return server;
};
