import { type DataMode, requestDataMode } from "@/infrastructure/data-mode-policy";
import {
  CATEGORY,
  type ModelDisclosure,
  type UnrecordedModelCall,
} from "@/infrastructure/disclosure-ledger";

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
 *
 * The model gets `starterDisclosure`: a model that is not on this machine
 * writes the request to the disclosure ledger (#140) before it is sent; a
 * request that cannot be recorded is not sent, and the fixed starters show.
 * The person's interest goes with it as what they typed (#414), so the free
 * text check does not count a stored value they wrote there themselves.
 */

export type StarterModelDeps<Model> = Readonly<{
  /** The default model selection, first choice first; `null` when unreachable. */
  loadModelIds: () => Promise<readonly string[] | null>;
  resolveModel: (
    modelId: string,
    options: Readonly<{
      hasWearableNarrative: boolean;
      disclosure: ModelDisclosure | UnrecordedModelCall;
      typed?: readonly string[];
    }>,
  ) => Model;
  dataMode: () => DataMode;
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

/** What a starter request carries: the person's onboarding answers and linked source names. */
export const starterDisclosure = (
  actor: string,
  mode: DataMode,
  hasLinkedData: boolean,
): ModelDisclosure => ({
  actor,
  sessionId: actor,
  threadId: null,
  purpose: "starter questions",
  categories: [CATEGORY.onboarding],
  refs: [],
  synthetic: requestDataMode(mode, hasLinkedData) === "synthetic",
});

export const createStarterGenerate =
  <Model>(deps: StarterModelDeps<Model>) =>
  (hasLinkedData: boolean, actor: string): StarterGenerate =>
  async ({ system, prompt, abortSignal, typed }) => {
    const modelId = (await deps.loadModelIds())?.[0];
    if (!modelId) throw new Error("No model in the active catalog");
    const model = deps.resolveModel(modelId, {
      hasWearableNarrative: hasLinkedData,
      disclosure: starterDisclosure(actor, deps.dataMode(), hasLinkedData),
      typed,
    });
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
