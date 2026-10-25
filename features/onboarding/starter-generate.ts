import type { StarterGenerate } from "./starter-questions";

/**
 * The model call behind the starter questions, with every outside piece
 * injected: the route passes the catalog read, `resolveLanguageModel` and
 * `generateText`. Kept here so the rules that matter are tested: whether the
 * person has linked data reaches the provider policy, which refuses
 * third-party providers when it is true; and `recordSend` runs after the
 * policy and before the model call, so a personal request to a hosted model
 * is in the audit chain first. A failed `recordSend` throws, the model is not
 * called, and the starter step shows its fixed starters.
 */

export type StarterModelDeps<Model> = Readonly<{
  /** The default model selection, first choice first; `null` when unreachable. */
  loadModelIds: () => Promise<readonly string[] | null>;
  resolveModel: (
    modelId: string,
    options: Readonly<{ hasWearableNarrative: boolean }>,
  ) => Model;
  /** Writes the audit event when this request needs one; throws if it cannot. */
  recordSend: (
    input: Readonly<{ actor: string; modelId: string; hasWearableNarrative: boolean }>,
  ) => Promise<void>;
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
  (hasLinkedData: boolean, actor: string): StarterGenerate =>
  async ({ system, prompt, abortSignal }) => {
    const modelId = (await deps.loadModelIds())?.[0];
    if (!modelId) throw new Error("No model in the active catalog");
    const model = deps.resolveModel(modelId, { hasWearableNarrative: hasLinkedData });
    await deps.recordSend({ actor, modelId, hasWearableNarrative: hasLinkedData });
    const { text } = await deps.generateText({
      model,
      system,
      prompt,
      abortSignal,
      maxRetries: 0,
    });
    return text;
  };
