import "server-only";

import type { ToolSet } from "ai";

import { requestDataMode } from "@/infrastructure/data-mode-policy";
import {
  type KnowledgeSourceId,
  withoutDisabledTools,
} from "@/infrastructure/knowledge-sources";

import { createGbdTools } from "@/packages/gbd-mcp/ai-tools";
import { createGuidelineTools } from "@/packages/guidelines/ai-tools";
import { createKnowledgeTools } from "@/packages/knowledge/ai-tools";
import { permitServerForDataMode } from "@/packages/mcp-client/policy";
import { findServer } from "@/packages/mcp-client/registry";
import { createQueryTools } from "@/packages/query-tools/ai-tools";
import type { QueryToolPorts } from "@/packages/query-tools/ports";
import type { SessionScope } from "@/packages/query-tools/scope";

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
 * Every tool a chat turn gets, in one place so the live tool-call smoke and the
 * eval harness send the same set. Tests pass fake query ports. Tools served by
 * a remote MCP server (GBD) are left out of a personal request.
 */
export const createChatTools = (
  scope: SessionScope,
  options?: Readonly<{ query?: QueryToolPorts; hasWearableNarrative?: boolean }>,
) => ({
  ...createQueryTools(scope, options?.query),
  ...(mcpServerPermitted("gbd", scope, options?.hasWearableNarrative ?? false)
    ? createGbdTools(scope)
    : {}),
  ...createGuidelineTools(scope),
  ...createKnowledgeTools(scope),
});

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
