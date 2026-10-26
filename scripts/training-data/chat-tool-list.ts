/**
 * The chat's tools as OpenAI function definitions, built from the same tool
 * set a chat turn gets (`createChatTools`): the nine query tools in their slim
 * form plus `gbd_population`, `guideline_search` and `knowledge_search`. The
 * schemas come from the AI SDK's own conversion, so a training record shows a
 * model exactly what a chat request sends. Pure: it only reads the tool set.
 */
import { asSchema, type JSONSchema7, type ToolSet } from "ai";

export type OpenAiTool = Readonly<{
  type: "function";
  function: Readonly<{ name: string; description: string; parameters: JSONSchema7 }>;
}>;

export const openAiToolsFrom = async (tools: ToolSet): Promise<OpenAiTool[]> =>
  Promise.all(
    Object.entries(tools).map(async ([name, tool]) => ({
      type: "function" as const,
      function: {
        name,
        // Chat tools have fixed descriptions; a per-call one would not belong in training data.
        description: typeof tool.description === "string" ? tool.description : name,
        parameters: await asSchema(tool.inputSchema).jsonSchema,
      },
    })),
  );
