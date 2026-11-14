import { AGENT_ID_PREFIX } from "@/infrastructure/agents";
import {
  AUTO_MODEL_ID,
  type CatalogModel,
  defaultModelSelection,
  findCatalogRow,
  MAX_SELECTED_MODELS,
  MIN_SELECTED_MODELS,
  pairedModelId,
  parsePairedModelId,
  turnModelName,
} from "@/infrastructure/model-catalog";

import type { PickedModel } from "./conversation";

/**
 * The three ways a prompt picks its answerers (SPEC 7.1–7.3). The server
 * never sees a mode: the picker turns it into the row ids (and display
 * names) sent, only ids the catalog offers, at most three. Pure, so the
 * rules are tested without a screen.
 */

export type ChatMode = "auto" | "manual" | "compare";

export const CHAT_MODES: readonly ChatMode[] = ["auto", "manual", "compare"];

export const MODE_COPY: Readonly<
  Record<ChatMode, Readonly<{ label: string; line: string }>>
> = {
  auto: {
    label: "Auto",
    line: "One answer: Auto picks the specialist and its model for each question.",
  },
  manual: {
    label: "Manual",
    line: "Pick specialists and models: each specialist runs on each model, up to three answers.",
  },
  compare: {
    label: "Compare",
    line: "Two or three models or specialists answer side by side.",
  },
};

/** Where the catalog's rows run, for the incognito local-only rule. */
export type ModeContext = Readonly<{
  catalog: readonly CatalogModel[];
  incognito: boolean;
  /** Catalog ids that run on this machine. */
  localModelIds: readonly string[];
}>;

export type ModeState = Readonly<{
  mode: ChatMode;
  /** Specialist rows (`agent:<id>`) chosen in Manual. */
  specialists: readonly string[];
  /** Plain model ids chosen in Manual. */
  models: readonly string[];
  /** Rows chosen in Compare. */
  compare: readonly string[];
  /** False while Compare's rows are defaults that follow the question. */
  compareChosen: boolean;
  /** The selection came from the thread's last turn and is unchanged. */
  fromThread: boolean;
}>;

// --- rows -------------------------------------------------------------------------

/** A row runs here: always outside incognito, else only a model on this machine. */
export const rowRunsHere = (id: string, context: ModeContext): boolean =>
  !context.incognito || context.localModelIds.includes(id);

export const specialistRows = (catalog: readonly CatalogModel[]): CatalogModel[] =>
  catalog.filter((row) => row.agent !== undefined && row.id !== AUTO_MODEL_ID);

export const plainModelRows = (catalog: readonly CatalogModel[]): CatalogModel[] =>
  catalog.filter((row) => row.agent === undefined);

export const autoOffered = (context: ModeContext): boolean =>
  context.catalog.some((row) => row.id === AUTO_MODEL_ID) &&
  rowRunsHere(AUTO_MODEL_ID, context);

/** The modes the picker offers: Auto only when the catalog has its row. */
export const offeredModes = (context: ModeContext): readonly ChatMode[] =>
  CHAT_MODES.filter((mode) => mode !== "auto" || autoOffered(context));

const offered = (id: string, context: ModeContext): boolean =>
  findCatalogRow(id, context.catalog) !== null && rowRunsHere(id, context);

/** Compare's default rows, fitted to the question (#493); never Auto. */
export const compareDefaults = (context: ModeContext, prompt = ""): readonly string[] => {
  const rows = context.catalog.filter(
    (row) => row.id !== AUTO_MODEL_ID && rowRunsHere(row.id, context),
  );
  return defaultModelSelection(rows, prompt).slice(0, MAX_SELECTED_MODELS);
};

const firstOf = (rows: readonly CatalogModel[], context: ModeContext): string[] => {
  const first = rows.find((row) => rowRunsHere(row.id, context));
  return first === undefined ? [] : [first.id];
};

// --- initial selection ------------------------------------------------------------

const baseState = (context: ModeContext): ModeState => ({
  mode: autoOffered(context) ? "auto" : "compare",
  specialists: firstOf(specialistRows(context.catalog), context),
  models: firstOf(plainModelRows(context.catalog), context),
  compare: compareDefaults(context),
  compareChosen: false,
  fromThread: false,
});

/** A row as Manual's two lists hold it: its specialist and its model. */
const manualParts = (
  id: string,
  context: ModeContext,
): Readonly<{ specialist: string | null; model: string | null }> => {
  const pair = parsePairedModelId(id);
  if (pair !== null) {
    return { specialist: `${AGENT_ID_PREFIX}${pair.agentId}`, model: pair.modelId };
  }
  const row = findCatalogRow(id, context.catalog);
  if (row === null) return { specialist: null, model: null };
  return row.agent === undefined
    ? { specialist: null, model: row.id }
    : { specialist: row.id, model: row.agent.baseModelId };
};

const unique = (ids: readonly (string | null)[]): string[] => [
  ...new Set(ids.filter((id): id is string => id !== null)),
];

/**
 * Where the picker starts (SPEC 7.2): a new chat on Auto when offered, else
 * Compare; a reopened thread in the mode and rows of its last turn.
 */
export const initialModeState = (
  context: ModeContext,
  lastTurnModelIds: readonly string[] | null,
): ModeState => {
  const base = baseState(context);
  if (lastTurnModelIds === null || lastTurnModelIds.length === 0) return base;
  const ids = [...new Set(lastTurnModelIds)];
  if (ids.length === 1 && ids[0] === AUTO_MODEL_ID) {
    return autoOffered(context) ? { ...base, mode: "auto", fromThread: true } : base;
  }
  const live = ids.filter((id) => id !== AUTO_MODEL_ID && offered(id, context));
  const manual = (rows: readonly string[]): ModeState => {
    const parts = rows.map((id) => manualParts(id, context));
    return {
      ...base,
      mode: "manual",
      specialists: unique(parts.map((part) => part.specialist)),
      models: unique(parts.map((part) => part.model)),
      fromThread: true,
    };
  };
  if (live.some((id) => parsePairedModelId(id) !== null)) return manual(live);
  if (ids.length === 1 && live.length === 1) return manual(live);
  if (live.length > 0) {
    return {
      ...base,
      mode: "compare",
      compare: live.slice(0, MAX_SELECTED_MODELS),
      compareChosen: true,
      fromThread: true,
    };
  }
  return { ...base, fromThread: true };
};

// --- what is sent -----------------------------------------------------------------

/** Compare's rows as shown and sent: refitted to the question until chosen. */
export const compareRows = (
  state: ModeState,
  context: ModeContext,
  prompt: string,
): readonly string[] =>
  state.compareChosen ? state.compare : compareDefaults(context, prompt);

/** The ids Manual sends, before the at-most-three rule. */
export const manualIds = (state: ModeState, context: ModeContext): string[] => {
  const models = state.models.filter((id) => offered(id, context));
  const specialists = state.specialists.filter((id) => offered(id, context));
  if (specialists.length === 0) return models;
  return specialists.flatMap((specialist) => {
    const row = findCatalogRow(specialist, context.catalog);
    const agentId = specialist.slice(AGENT_ID_PREFIX.length);
    return models.map((model) =>
      row?.agent?.baseModelId === model ? specialist : pairedModelId(agentId, model),
    );
  });
};

/** How many answers the state asks for, before the cap. */
export const answerCount = (
  state: ModeState,
  context: ModeContext,
  prompt: string,
): number =>
  state.mode === "auto"
    ? 1
    : state.mode === "manual"
      ? manualIds(state, context).length
      : compareRows(state, context, prompt).filter((id) => offered(id, context)).length;

/** What the current mode is missing, or null when it can send. */
export const modeProblem = (
  state: ModeState,
  context: ModeContext,
  prompt: string,
): string | null => {
  if (state.mode === "auto") {
    return autoOffered(context) ? null : "Auto isn't available on this server.";
  }
  if (state.mode === "manual") {
    if (state.models.filter((id) => offered(id, context)).length === 0) {
      return "Pick at least one model.";
    }
    return manualIds(state, context).length > MAX_SELECTED_MODELS
      ? "Three answers at most."
      : null;
  }
  const count = answerCount(state, context, prompt);
  return count < 2 || count > MAX_SELECTED_MODELS
    ? "Compare needs two or three models or specialists."
    : null;
};

/** The answerers a prompt goes to, with the names their columns show. */
export const pickedModels = (
  state: ModeState,
  context: ModeContext,
  prompt: string,
): readonly PickedModel[] => {
  const ids =
    state.mode === "auto"
      ? autoOffered(context)
        ? [AUTO_MODEL_ID]
        : []
      : state.mode === "manual"
        ? manualIds(state, context)
        : compareRows(state, context, prompt);
  return [...new Set(ids)]
    .filter((id) => offered(id, context))
    .slice(0, MAX_SELECTED_MODELS)
    .flatMap((id) => {
      const row = findCatalogRow(id, context.catalog);
      if (row === null) return [];
      return [
        { id, name: turnModelName({ id, name: row.name }, context.catalog, prompt) },
      ];
    });
};

/** The mode pill: "Auto", "Manual · 2 answers", "Compare · 3 models". */
export const modeSummary = (
  state: ModeState,
  context: ModeContext,
  prompt: string,
): string => {
  if (state.mode === "auto") return MODE_COPY.auto.label;
  const count = answerCount(state, context, prompt);
  return state.mode === "manual"
    ? `Manual · ${String(count)} ${count === 1 ? "answer" : "answers"}`
    : `Compare · ${String(count)} ${count === 1 ? "model" : "models"}`;
};

/** The picker's footer: what is missing, else the count. */
export const pickerFooter = (
  state: ModeState,
  context: ModeContext,
  prompt: string,
): string =>
  modeProblem(state, context, prompt) ??
  (state.mode === "auto"
    ? "One answer per prompt."
    : `${String(answerCount(state, context, prompt))} of at most ${String(MAX_SELECTED_MODELS)} answers.`);

/**
 * The last turn's rows the catalog no longer offers: how many dropped and
 * how many remain.
 */
export const droppedModels = (
  lastTurnModelIds: readonly string[] | null,
  context: ModeContext,
): Readonly<{ dropped: number; remaining: number }> => {
  const ids = [...new Set(lastTurnModelIds ?? [])];
  const remaining = ids.filter((id) => offered(id, context)).length;
  return { dropped: ids.length - remaining, remaining };
};

// --- changes ----------------------------------------------------------------------

export type PickerList = "specialists" | "models" | "compare";

const listOf = (state: ModeState, list: PickerList, current: readonly string[]) =>
  list === "specialists" ? state.specialists : list === "models" ? state.models : current;

const toggled = (ids: readonly string[], id: string): string[] =>
  ids.includes(id) ? ids.filter((each) => each !== id) : [...ids, id];

/** The state with one box ticked or unticked; the rule is checked by `boxDisabled`. */
export const toggleRow = (
  state: ModeState,
  list: PickerList,
  id: string,
  context: ModeContext,
  prompt: string,
): ModeState => {
  const current = compareRows(state, context, prompt);
  const next = toggled(listOf(state, list, current), id);
  return list === "specialists"
    ? { ...state, specialists: next, fromThread: false }
    : list === "models"
      ? { ...state, models: next, fromThread: false }
      : { ...state, compare: next, compareChosen: true, fromThread: false };
};

export const setMode = (state: ModeState, mode: ChatMode): ModeState => ({
  ...state,
  mode,
  fromThread: false,
});

/**
 * Why a box may not change, or null when it may: one more would break the
 * at-most-three rule, one fewer would leave Manual without a model or
 * Compare without a row, or the row does not run on this machine.
 */
export const boxDisabled = (
  state: ModeState,
  list: PickerList,
  id: string,
  context: ModeContext,
  prompt: string,
): string | null => {
  if (!rowRunsHere(id, context))
    return "Not on this machine, so not for incognito chats.";
  const current = compareRows(state, context, prompt);
  const checked = listOf(state, list, current).includes(id);
  const next = toggleRow(state, list, id, context, prompt);
  if (checked) {
    if (list === "models" && next.models.length < MIN_SELECTED_MODELS) {
      return "Manual needs at least one model.";
    }
    if (list === "compare" && next.compare.length < MIN_SELECTED_MODELS) {
      return "Compare needs at least one row.";
    }
    return null;
  }
  return answerCount(next, context, prompt) > MAX_SELECTED_MODELS
    ? "Three answers at most."
    : null;
};

/** Whether a box is ticked in its list. */
export const boxChecked = (
  state: ModeState,
  list: PickerList,
  id: string,
  context: ModeContext,
  prompt: string,
): boolean => listOf(state, list, compareRows(state, context, prompt)).includes(id);
