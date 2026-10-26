import {
  type CatalogModel,
  MAX_SELECTED_MODELS,
  MIN_SELECTED_MODELS,
} from "@/infrastructure/model-catalog";

/**
 * Everything about a new turn that can be decided without the database, kept
 * pure so the copy and the order of the checks are tested with plain values.
 * `start-turn.ts` runs these, then does the writes.
 */

export const TITLE_LENGTH = 80;

export const TURN_COPY = {
  signIn: "Sign in to send a prompt to TwinLLM.",
  emptyPrompt: "Write a prompt before sending.",
  modelCount: "Pick between one and three models.",
  noCatalog: "We can't reach the model list right now. Try again in a moment.",
  notFreeAnyMore: "One of those models isn't on the free list any more. Pick another.",
  notOnProvider:
    "One of those models isn't available for the active provider. Pick another.",
  threadGone: "That thread doesn't exist any more.",
  notYourThread: "That thread isn't yours to add to.",
} as const;

export type TurnPlan = Readonly<{
  prompt: string;
  title: string;
  models: readonly Readonly<{ id: string; name: string }>[];
}>;

export type TurnCheck =
  Readonly<{ ok: true; plan: TurnPlan }> | Readonly<{ ok: false; error: string }>;

const refuse = (error: string): TurnCheck => ({ ok: false, error });

/**
 * The prompt is trimmed, ids de-duplicated, and names always taken from the
 * catalog: what the browser says a model is called is never stored.
 */
export const checkTurnRequest = (
  request: Readonly<{ prompt: string; modelIds: readonly string[] }>,
  catalog: readonly CatalogModel[] | null,
  provider: string,
): TurnCheck => {
  const prompt = request.prompt.trim();
  if (prompt === "") return refuse(TURN_COPY.emptyPrompt);

  const ids = [...new Set(request.modelIds)];
  if (ids.length < MIN_SELECTED_MODELS || ids.length > MAX_SELECTED_MODELS) {
    return refuse(TURN_COPY.modelCount);
  }
  if (!catalog) return refuse(TURN_COPY.noCatalog);

  const models = ids.map((id) => catalog.find((model) => model.id === id));
  if (models.some((model) => model === undefined)) {
    return refuse(
      provider === "openrouter" ? TURN_COPY.notFreeAnyMore : TURN_COPY.notOnProvider,
    );
  }

  return {
    ok: true,
    plan: {
      prompt,
      title: prompt.slice(0, TITLE_LENGTH),
      models: models.flatMap((model) =>
        model ? [{ id: model.id, name: model.name }] : [],
      ),
    },
  };
};
