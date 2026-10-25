import "server-only";

import type { ToolSet } from "ai";

import {
  type KnowledgeSourceId,
  withoutDisabledTools,
} from "@/infrastructure/knowledge-sources";

import { createGbdTools } from "@/packages/gbd-mcp/ai-tools";
import { createGuidelineTools } from "@/packages/guidelines/ai-tools";
import { createKnowledgeTools } from "@/packages/knowledge/ai-tools";
import { createQueryTools } from "@/packages/query-tools/ai-tools";
import type { QueryToolPorts } from "@/packages/query-tools/ports";
import type { SessionScope } from "@/packages/query-tools/scope";

/**
 * Every tool a chat turn gets, in one place so the live tool-call smoke and the
 * eval harness send the same set. Tests pass fake query ports.
 */
export const createChatTools = (
  scope: SessionScope,
  ports?: Readonly<{ query?: QueryToolPorts }>,
) => ({
  ...createQueryTools(scope, ports?.query),
  ...createGbdTools(scope),
  ...createGuidelineTools(scope),
  ...createKnowledgeTools(scope),
});

/**
 * The tools a turn actually gets once a user's source choices are
 * applied, and the names to give the system prompt. Nothing turned off gives
 * the full set and no list, so the prompt stays exactly as before.
 */
export const forSources = (
  tools: ToolSet,
  disabledSources: readonly KnowledgeSourceId[],
): Readonly<{ tools: ToolSet; offeredTools: ReadonlySet<string> | undefined }> => {
  const kept = withoutDisabledTools(tools, disabledSources);
  return {
    tools: kept,
    offeredTools: disabledSources.length > 0 ? new Set(Object.keys(kept)) : undefined,
  };
};
