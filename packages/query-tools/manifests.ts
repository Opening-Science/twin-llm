import { z } from "zod";

import { GBD_ESTIMATE_TOOL_DEFINITION } from "./gbd-estimate-schema";
import { IMPORTED_TOOL_DEFINITIONS } from "./imported-schemas";
import { GENOME_VARIANTS_TOOL_DEFINITION } from "./imported-variants-schema";
import { modelJsonSchema } from "./model-schema";
import { TOOL_DEFINITIONS } from "./schemas";
import { VIEW_TOOL_DEFINITIONS } from "./view-schema";

/**
 * The tools as OpenAI function definitions, in the slim form models get: the
 * query tools, then the view tools (`show_view`, `list_views`, `open_view`),
 * then `gbd_estimate`, which chat offers only once GBD results are imported
 * (#387).
 */
export const openaiToolList = () =>
  [...TOOL_DEFINITIONS, ...VIEW_TOOL_DEFINITIONS, GBD_ESTIMATE_TOOL_DEFINITION].map(
    (definition) => ({
      type: "function" as const,
      function: {
        name: definition.name,
        description: definition.description,
        parameters: modelJsonSchema(definition.input),
      },
    }),
  );

/**
 * The MCP manifest keeps zod's full JSON Schema, regex patterns included: it is
 * the contract for external clients, which may validate arguments with it.
 * The imported-data tools are listed so a client learns why they refuse: an
 * MCP client's model is not known to run on this machine, so they always do.
 * `genome_variants` (#307) is listed for the same reason and refuses with
 * `GENOME_NOT_PERMITTED`. The Ark report tools are not listed at all.
 */
export const mcpToolManifest = () => ({
  tools: [
    ...TOOL_DEFINITIONS,
    ...IMPORTED_TOOL_DEFINITIONS,
    GENOME_VARIANTS_TOOL_DEFINITION,
  ].map((definition) => ({
    name: definition.name,
    description: definition.description,
    inputSchema: z.toJSONSchema(definition.input),
  })),
});
