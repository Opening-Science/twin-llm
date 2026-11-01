import { tool } from "ai";

import { recordGbdRows } from "@/packages/gbd-mcp/collector";
import {
  runGbdEstimate,
  type GbdEstimatePorts,
} from "@/packages/query-tools/gbd-estimate";
import {
  GBD_ESTIMATE_TOOL_DEFINITION,
  gbdEstimateInput,
} from "@/packages/query-tools/gbd-estimate-schema";
import { modelInputSchema } from "@/packages/query-tools/model-schema";
import { isToolRefusal } from "@/packages/query-tools/refusals";
import type { SessionScope } from "@/packages/query-tools/scope";

import { GBD_ESTIMATE_TOOL } from "./constants";
import { gbdPanelRows } from "./panel-rows";

/**
 * The chat tool over the local GBD store. Chat offers it only when estimates
 * are imported (`chat-tools.ts`), in either data mode: it reads population
 * rows on this machine and sends nothing.
 */
export const createGbdEstimateTool = (scope: SessionScope, ports: GbdEstimatePorts) => ({
  [GBD_ESTIMATE_TOOL]: tool({
    description: GBD_ESTIMATE_TOOL_DEFINITION.description,
    inputSchema: modelInputSchema(gbdEstimateInput),
    execute: async (input) => {
      const result = await runGbdEstimate(scope, input, ports);
      if (!isToolRefusal(result) && "rows" in result) {
        recordGbdRows(scope.sessionId, gbdPanelRows(result));
      }
      return result;
    },
  }),
});
