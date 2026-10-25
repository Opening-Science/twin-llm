import { z } from "zod";

import { modelJsonSchema } from "./model-schema";
import { TOOL_DEFINITIONS } from "./schemas";

/** The tools as OpenAI function definitions, in the slim form models get. */
export const openaiToolList = () =>
  TOOL_DEFINITIONS.map((definition) => ({
    type: "function" as const,
    function: {
      name: definition.name,
      description: definition.description,
      parameters: modelJsonSchema(definition.input),
    },
  }));

/**
 * The MCP manifest keeps zod's full JSON Schema, regex patterns included: it is
 * the contract for external clients, which may validate arguments with it.
 */
export const mcpToolManifest = () => ({
  tools: TOOL_DEFINITIONS.map((definition) => ({
    name: definition.name,
    description: definition.description,
    inputSchema: z.toJSONSchema(definition.input),
  })),
});
