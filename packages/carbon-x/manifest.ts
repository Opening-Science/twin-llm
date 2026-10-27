import { modelJsonSchema } from "@/packages/query-tools/model-schema";

import { GENOME_TOOL_DEFINITIONS } from "./schema";

/**
 * The genome tools in the slim form models get. Kept apart from
 * `openaiToolList()`: that list feeds training data and the eval harness,
 * which are synthetic and never see a genome tool.
 */
export const genomeToolList = () =>
  GENOME_TOOL_DEFINITIONS.map((definition) => ({
    type: "function" as const,
    function: {
      name: definition.name,
      description: definition.description,
      parameters: modelJsonSchema(definition.input),
    },
  }));
