import { z } from "zod";

import { TOOL_DEFINITIONS } from "./schemas";

export const openaiToolList = () =>
  TOOL_DEFINITIONS.map((definition) => ({
    type: "function" as const,
    function: {
      name: definition.name,
      description: definition.description,
      parameters: z.toJSONSchema(definition.input),
    },
  }));

export const mcpToolManifest = () => ({
  tools: TOOL_DEFINITIONS.map((definition) => ({
    name: definition.name,
    description: definition.description,
    inputSchema: z.toJSONSchema(definition.input),
  })),
});
