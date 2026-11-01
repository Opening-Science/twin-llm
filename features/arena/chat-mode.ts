import { AGENT_ID_PREFIX } from "@/infrastructure/agents";
import {
  AUTO_MODEL_ID,
  type CatalogModel,
  defaultModelSelection,
  findCatalogRow,
  MAX_SELECTED_MODELS,
  pairedModelId,
  parsePairedModelId,
} from "@/infrastructure/model-catalog";

/**
 * Modes (#366): how a prompt picks what answers it, chosen on its own and
 * apart from the model list.
 *
 * - Auto: one answer. Auto (`agent-router.ts`) picks the specialist for each
 *   question, and the specialist its model; the next turn may pick others.
 * - Manual: the person picks specialists and one to three models. Each
 *   specialist runs on each model, at most three answers in all. No
 *   specialist means the models answer as themselves.
 * - Compare: the same question to two or three rows side by side, models or
 *   specialists, as the arena has always worked.
 *
 * Pure, so the prompt bar, a reopened thread and the tests agree on which ids
 * a prompt goes to. The server never sees a mode; it gets those ids.
 */

export const CHAT_MODES = ["auto", "manual", "compare"] as const;

export type ChatMode = (typeof CHAT_MODES)[number];

export const MODE_COPY: Readonly<Record<ChatMode, { label: string; line: string }>> = {
  auto: {
    label: "Auto",
    line: "One answer. TwinLLM picks the specialist and the model for each question.",
  },
  manual: {
    label: "Manual",
    line: "You pick the specialists and one to three models.",
  },
  compare: {
    label: "Compare",
    line: "The same question to two or three models side by side.",
  },
};

/** Compare needs at least this many rows; one row is Manual. */
export const MIN_COMPARE = 2;

export type ModeSelection = Readonly<{
  mode: ChatMode;
  /** Manual: specialist ids (`diet`, not `agent:diet`). */
  specialists: readonly string[];
  /** Manual: plain model ids. */
  models: readonly string[];
  /** Compare: catalog row ids, models or specialists. */
  compare: readonly string[];
}>;

/** The specialists the catalog offers, without Auto. */
export const specialistRows = (
  catalog: readonly CatalogModel[],
): readonly CatalogModel[] =>
  catalog.filter((row) => row.agent !== undefined && row.id !== AUTO_MODEL_ID);

/** The plain models the catalog offers. */
export const plainModels = (catalog: readonly CatalogModel[]): readonly CatalogModel[] =>
  catalog.filter((row) => row.agent === undefined);

/** Answers a Manual prompt asks for: specialists (at least one slot) times models. */
export const manualAnswerCount = (specialists: number, models: number): number =>
  Math.max(specialists, 1) * models;

/**
 * The row id of one Manual answer: the specialist's own row when the model is
 * the one it runs on anyway, else the pair.
 */
const manualId = (
  specialistId: string,
  modelId: string,
  catalog: readonly CatalogModel[],
): string => {
  const own = `${AGENT_ID_PREFIX}${specialistId}`;
  return findCatalogRow(own, catalog)?.agent?.baseModelId === modelId
    ? own
    : pairedModelId(specialistId, modelId);
};

/** The ids a prompt goes to in its mode, only those the catalog offers, at most three. */
export const modeModelIds = (
  selection: ModeSelection,
  catalog: readonly CatalogModel[],
): readonly string[] => {
  const offered = (ids: readonly string[]) =>
    ids
      .filter((id) => findCatalogRow(id, catalog) !== null)
      .slice(0, MAX_SELECTED_MODELS);
  if (selection.mode === "auto") return offered([AUTO_MODEL_ID]);
  if (selection.mode === "compare") {
    return offered(selection.compare.filter((id) => id !== AUTO_MODEL_ID));
  }
  if (selection.specialists.length === 0) return offered(selection.models);
  return offered(
    selection.specialists.flatMap((specialist) =>
      selection.models.map((model) => manualId(specialist, model, catalog)),
    ),
  );
};

/** Why a prompt cannot be sent in this mode yet, in words; null when it can. */
export const modeProblem = (
  selection: ModeSelection,
  catalog: readonly CatalogModel[],
): string | null => {
  const ids = modeModelIds(selection, catalog);
  if (selection.mode === "auto") {
    return ids.length === 0
      ? "Auto needs the specialists, which this server does not offer. Choose Manual or Compare."
      : null;
  }
  if (selection.mode === "compare") {
    return ids.length < MIN_COMPARE ? "Compare needs two or three models." : null;
  }
  if (selection.models.length === 0) return "Pick at least one model.";
  return manualAnswerCount(selection.specialists.length, selection.models.length) >
    MAX_SELECTED_MODELS
    ? "Three answers is the most one prompt can ask for. Pick fewer specialists or models."
    : null;
};

/**
 * Adds or removes one entry of a Manual list, unless that would ask for more
 * than three answers or leave no model.
 */
export const toggleManual = (
  selection: ModeSelection,
  list: "specialists" | "models",
  id: string,
): ModeSelection => {
  const current = selection[list];
  const next = current.includes(id)
    ? current.filter((each) => each !== id)
    : [...current, id];
  const specialists = list === "specialists" ? next : selection.specialists;
  const models = list === "models" ? next : selection.models;
  if (models.length === 0) return selection;
  if (manualAnswerCount(specialists.length, models.length) > MAX_SELECTED_MODELS) {
    return selection;
  }
  return { ...selection, [list]: next };
};

/**
 * The selection a prompt bar opens with. A new chat starts in Auto when the
 * catalog offers it. A thread reopens in the mode its last ids say: Auto's
 * one row, Manual when a pair is among them or there is one row, else
 * Compare (threads from before modes). The other modes start from sensible picks, so switching
 * never opens on an empty list.
 */
export const initialSelection = (
  ids: readonly string[],
  catalog: readonly CatalogModel[],
): ModeSelection => {
  const firstModel = plainModels(catalog)[0]?.id;
  const firstSpecialist = specialistRows(catalog)[0]?.agent?.id;
  const autoOffered = findCatalogRow(AUTO_MODEL_ID, catalog) !== null;
  const offeredIds = ids.filter((id) => findCatalogRow(id, catalog) !== null);
  const pairs = ids.flatMap((id) => {
    const pair = parsePairedModelId(id);
    return pair === null ? [] : [pair];
  });
  const base: ModeSelection = {
    mode: autoOffered ? "auto" : "compare",
    specialists: firstSpecialist === undefined ? [] : [firstSpecialist],
    models: firstModel === undefined ? [] : [firstModel],
    compare: defaultModelSelection(catalog).filter((id) => id !== AUTO_MODEL_ID),
  };
  if (ids.length === 0) return base;
  if (ids.length === 1 && ids[0] === AUTO_MODEL_ID) return { ...base, mode: "auto" };
  if (pairs.length > 0) {
    const unique = (values: readonly string[]) => [...new Set(values)];
    const rows = ids.flatMap((id) => {
      const agent = findCatalogRow(id, catalog)?.agent;
      return agent === undefined ? [] : [agent];
    });
    return {
      ...base,
      mode: "manual",
      specialists: unique(rows.map((agent) => agent.id)),
      models: unique(rows.map((agent) => agent.baseModelId)),
    };
  }
  const [only] = offeredIds;
  if (offeredIds.length === 1 && only !== undefined) {
    const agent = findCatalogRow(only, catalog)?.agent;
    return {
      ...base,
      mode: "manual",
      specialists: agent === undefined ? [] : [agent.id],
      models: [agent?.baseModelId ?? only],
    };
  }
  return {
    ...base,
    mode: offeredIds.length === 0 && autoOffered ? "auto" : "compare",
    compare: offeredIds.length === 0 ? base.compare : offeredIds,
  };
};
