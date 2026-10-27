import "server-only";

import { database } from "@/infrastructure/database";
import { genomeEnv } from "@/infrastructure/env";
import { genomeChatPermit } from "@/infrastructure/genome-gate";
import { latestGenomeReport } from "@/infrastructure/genome-report-store";
import { append } from "@/packages/audit/append";
import { askCarbonX } from "@/packages/carbon-x/client";
import { referenceWindows } from "@/packages/genome-reference";
import type { SessionScope } from "@/packages/query-tools/scope";

import type { GenomeToolDeps } from "./genome-tools";

/**
 * The real ports behind the genome tools, or undefined when this turn may not
 * have them. Only the chat route asks; the eval harness and the training
 * generator never pass genome deps, so the tools are never in their lists.
 */
export const genomeToolDepsFor = (scope: SessionScope): GenomeToolDeps | undefined => {
  if (scope.mode !== "personal" || !genomeChatPermit().ok) return undefined;
  const env = genomeEnv();
  return {
    scope,
    loadReport: () => latestGenomeReport(scope.actor),
    assumeBuild: env.assumeBuild,
    windows: (request) => referenceWindows(env.referenceDir, request),
    ask: (messages) =>
      askCarbonX({ baseUrl: env.carbonXUrl, timeoutMs: env.carbonXTimeoutMs }, messages),
    appendAudit: (input) => append(database(), input),
  };
};
