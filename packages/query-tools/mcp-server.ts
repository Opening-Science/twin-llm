import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { DataMode } from "@/infrastructure/data-mode-policy";

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
} from "./tools";

/**
 * The nine query tools as an MCP server. The tool list is the committed
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

export type QueryToolName = (typeof TOOL_DEFINITIONS)[number]["name"];

export type QueryToolRunner = (args: unknown) => Promise<unknown>;

export type QueryToolRunners = Readonly<Record<QueryToolName, QueryToolRunner>>;

const bind =
  <Input>(
    schema: z.ZodType<Input>,
    run: (input: Input) => Promise<unknown>,
  ): QueryToolRunner =>
  (args) =>
    run(schema.parse(args));

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
});

export const QUERY_MCP_SERVER_INFO = {
  name: "twinllm-query-tools",
  version: "0.1.0",
} as const;

const isQueryToolName = (name: string): name is QueryToolName =>
  TOOL_DEFINITIONS.some((definition) => definition.name === name);

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
