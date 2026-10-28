import "server-only";

import type { ToolSet } from "ai";

import { requestDataMode } from "@/infrastructure/data-mode-policy";
import {
  disabledToolNames,
  type KnowledgeSourceId,
  withoutDisabledTools,
} from "@/infrastructure/knowledge-sources";
import type { WearableSummaries } from "@/infrastructure/offered-keys";
import { type TurnSkill, withSkillTools } from "@/infrastructure/skill-gate";

import { createGbdTools } from "@/packages/gbd-mcp/ai-tools";
import { createGuidelineTools } from "@/packages/guidelines/ai-tools";
import { createKnowledgeTools } from "@/packages/knowledge/ai-tools";
import { permitServerForDataMode } from "@/packages/mcp-client/policy";
import { findServer } from "@/packages/mcp-client/registry";
import { createImportedTools, createQueryTools } from "@/packages/query-tools/ai-tools";
import type { ImportedToolDeps } from "@/packages/query-tools/imported-tools";
import type { QueryToolPorts } from "@/packages/query-tools/ports";
import type { SessionScope } from "@/packages/query-tools/scope";

import { createGenomeTools, type GenomeToolDeps } from "./genome-tools";
import { loadThreadViews } from "./load-thread-views";
import { createShowViewTool } from "./show-view-tool";
import { createViewTools, type ViewToolDeps } from "./view-tools";

/** The source whose tools read a subject's records. */
const COHORT_RECORDS_SOURCE: KnowledgeSourceId = "cohort-records";

const NO_WEARABLES: WearableSummaries = {
  oura: null,
  whoop: null,
  googleHealth: null,
  vitronic: null,
};

/**
 * True when this request may use the named MCP server's tools. A personal
 * request (DATA_MODE=personal or wearable context) never reaches a remote
 * server; a server missing from the registry is never used.
 */
const mcpServerPermitted = (
  name: string,
  scope: SessionScope,
  hasWearableNarrative: boolean,
): boolean => {
  const server = findServer(name);
  return (
    server !== undefined &&
    permitServerForDataMode(server, requestDataMode(scope.mode, hasWearableNarrative)).ok
  );
};

/**
 * The factories behind the chat tools. Only `query` (for its four wearable
 * tools) and `showView` are handed the turn's wearable snapshots; every other
 * factory gets the scope (and query ports) alone. Tests pass spies here to
 * check that structurally.
 */
export type ChatToolFactories = Readonly<{
  query: typeof createQueryTools;
  showView: typeof createShowViewTool;
  views: typeof createViewTools;
  gbd: typeof createGbdTools;
  guidelines: typeof createGuidelineTools;
  knowledge: typeof createKnowledgeTools;
}>;

const CHAT_TOOL_FACTORIES: ChatToolFactories = {
  query: createQueryTools,
  showView: createShowViewTool,
  views: createViewTools,
  gbd: createGbdTools,
  guidelines: createGuidelineTools,
  knowledge: createKnowledgeTools,
};

/**
 * Every tool a chat turn gets, in one place so the live tool-call smoke and the
 * eval harness send the same set. Tests pass fake query ports. Tools served by
 * a remote MCP server (GBD) are left out of a personal request.
 *
 * `show_view` belongs to no source: it is how any answer shows a chart. It
 * reads cohort rows only while the cohort record tools are on, and wearable
 * readings only from the snapshots this turn already loaded, which synthetic
 * mode never does. It and the wearable query tools (`sleep_summary`,
 * `hrv_trend`, `resting_hr_trend`, `training_load`) are the only tools that
 * receive those snapshots.
 *
 * `list_views` and `open_view` read the views this thread already showed
 * (`thread-views.ts`); a synthetic request is not offered wearable ones.
 */
export const createChatTools = (
  scope: SessionScope,
  options?: Readonly<{
    query?: QueryToolPorts;
    hasWearableNarrative?: boolean;
    wearables?: WearableSummaries;
    disabledSources?: readonly KnowledgeSourceId[];
    /** View kinds `show_view` may draw (a skill's `views`); left out, every kind. */
    views?: readonly string[];
    /**
     * A skill's `sources`; left out, every source. Without `cohort-records`
     * `show_view` reads no subject, as the skill's tools read none.
     */
    sources?: readonly string[];
    loadViews?: ViewToolDeps["loadViews"];
    factories?: ChatToolFactories;
    /**
     * Ports for `genome_report` and `dna_ask`. Only the chat route passes them,
     * and only after the genome policy allowed this turn; a synthetic scope
     * never gets them. The eval tool list never includes them; training
     * includes them only for its synthetic `--genome` records.
     */
    genome?: GenomeToolDeps;
    /**
     * Ports for the imported-data tools (#181). Only the chat route passes
     * them, and only after the imported-data policy allowed this turn
     * (personal mode, Ollama on loopback); a synthetic scope never gets them.
     */
    imported?: ImportedToolDeps;
  }>,
) => {
  const make = options?.factories ?? CHAT_TOOL_FACTORIES;
  const hasWearableNarrative = options?.hasWearableNarrative ?? false;
  return {
    ...make.query(scope, options?.query, options?.wearables ?? NO_WEARABLES),
    ...make.showView({
      scope,
      ports: options?.query,
      wearables: options?.wearables ?? NO_WEARABLES,
      cohortRecords: !disabledToolNames(options?.disabledSources ?? []).has(
        "observations_for_subject",
      ),
      views: options?.views,
      skillRecords: options?.sources?.includes(COHORT_RECORDS_SOURCE) ?? true,
    }),
    ...make.views({
      scope,
      ports: options?.query,
      loadViews: options?.loadViews ?? loadThreadViews,
      personal: requestDataMode(scope.mode, hasWearableNarrative) === "personal",
      views: options?.views,
    }),
    ...(mcpServerPermitted("gbd", scope, hasWearableNarrative) ? make.gbd(scope) : {}),
    ...make.guidelines(scope),
    ...make.knowledge(scope),
    ...(options?.genome !== undefined && scope.mode === "personal"
      ? createGenomeTools(options.genome)
      : {}),
    ...(options?.imported !== undefined && scope.mode === "personal"
      ? createImportedTools(options.imported)
      : {}),
  };
};

/**
 * The tools a turn actually gets once a user's source choices are applied,
 * and the names to give the system prompt. The prompt names only these, so it
 * never mentions a tool that was turned off or withheld for personal data;
 * with every tool present its text is unchanged.
 */
export const forSources = (
  tools: ToolSet,
  disabledSources: readonly KnowledgeSourceId[],
): Readonly<{ tools: ToolSet; offeredTools: ReadonlySet<string> | undefined }> => {
  const kept = withoutDisabledTools(tools, disabledSources);
  return {
    tools: kept,
    offeredTools: new Set(Object.keys(kept)),
  };
};

/**
 * The tools a skill turn keeps, after `forSources`: the skill's own list,
 * plus the view tools when it allows a kind `show_view` draws. Without a skill the
 * tools pass through unchanged. The prompt is told the same names.
 */
export const forSkill = (
  tools: ToolSet,
  skill: Pick<TurnSkill, "tools" | "views"> | null,
): Readonly<{ tools: ToolSet; offeredTools: ReadonlySet<string> }> => {
  const kept = skill === null ? tools : withSkillTools(tools, skill);
  return { tools: kept, offeredTools: new Set(Object.keys(kept)) };
};
