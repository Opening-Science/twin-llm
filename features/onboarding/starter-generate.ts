import type { StarterGenerate } from "./starter-questions";

/**
 * The model call behind the starter questions, with every outside piece
 * injected: the route passes the catalog read, `resolveLanguageModel` and
 * `generateText`. Kept here so the one rule that matters is tested: whether
 * the person has linked data reaches the provider policy, which refuses
 * OpenRouter and the remote GPU when it is true.
 */

export type StarterModelDeps<Model> = Readonly<{
  /** The default model selection, first choice first; `null` when unreachable. */
  loadModelIds: () => Promise<readonly string[] | null>;
  resolveModel: (
    modelId: string,
    options: Readonly<{ hasWearableNarrative: boolean }>,
  ) => Model;
  generateText: (
    input: Readonly<{
      model: Model;
      system: string;
      prompt: string;
      abortSignal: AbortSignal;
      maxRetries: number;
    }>,
  ) => Promise<Readonly<{ text: string }>>;
}>;

export const createStarterGenerate =
  <Model>(deps: StarterModelDeps<Model>) =>
  (hasLinkedData: boolean): StarterGenerate =>
  async ({ system, prompt, abortSignal }) => {
    const modelId = (await deps.loadModelIds())?.[0];
    if (!modelId) throw new Error("No model in the active catalog");
    const { text } = await deps.generateText({
      model: deps.resolveModel(modelId, { hasWearableNarrative: hasLinkedData }),
      system,
      prompt,
      abortSignal,
      maxRetries: 0,
    });
    return text;
  };
