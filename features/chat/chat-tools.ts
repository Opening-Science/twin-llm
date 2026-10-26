import "server-only";

import type { ToolSet } from "ai";

import { requestDataMode } from "@/infrastructure/data-mode-policy";
import {
  disabledToolNames,
  type KnowledgeSourceId,
  withoutDisabledTools,
} from "@/infrastructure/knowledge-sources";
import type { WearableSummaries } from "@/infrastructure/offered-keys";

import { createGbdTools } from "@/packages/gbd-mcp/ai-tools";
import { createGuidelineTools } from "@/packages/guidelines/ai-tools";
import { createKnowledgeTools } from "@/packages/knowledge/ai-tools";
import { permitServerForDataMode } from "@/packages/mcp-client/policy";
import { findServer } from "@/packages/mcp-client/registry";
import { createQueryTools } from "@/packages/query-tools/ai-tools";
import type { QueryToolPorts } from "@/packages/query-tools/ports";
import type { SessionScope } from "@/packages/query-tools/scope";

import { loadThreadViews } from "./load-thread-views";
import { createShowViewTool } from "./show-view-tool";
import { createViewTools, type ViewToolDeps } from "./view-tools";

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
 * The factories behind the chat tools. Only `showView` is handed the turn's
 * wearable snapshots; every other factory gets the scope (and query ports)
 * alone. Tests pass spies here to check that structurally.
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
 * mode never does. It is the only tool that receives those snapshots.
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
    loadViews?: ViewToolDeps["loadViews"];
    factories?: ChatToolFactories;
  }>,
) => {
  const make = options?.factories ?? CHAT_TOOL_FACTORIES;
  const hasWearableNarrative = options?.hasWearableNarrative ?? false;
  return {
    ...make.query(scope, options?.query),
    ...make.showView({
      scope,
      ports: options?.query,
      wearables: options?.wearables ?? NO_WEARABLES,
      cohortRecords: !disabledToolNames(options?.disabledSources ?? []).has(
        "observations_for_subject",
      ),
    }),
    ...make.views({
      scope,
      ports: options?.query,
      loadViews: options?.loadViews ?? loadThreadViews,
      personal: requestDataMode(scope.mode, hasWearableNarrative) === "personal",
    }),
    ...(mcpServerPermitted("gbd", scope, hasWearableNarrative) ? make.gbd(scope) : {}),
    ...make.guidelines(scope),
    ...make.knowledge(scope),
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
