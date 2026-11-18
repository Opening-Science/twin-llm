import { routeAgent } from "@/infrastructure/agent-router";
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
import { friendlyModelName } from "@/infrastructure/model-names";

import type { PickedModel } from "./conversation";

/**
 * The ways a prompt picks its answerers (SPEC 7.1–7.3, #610). The server
 * never sees a mode: the picker turns it into the row ids (and display
 * names) sent, only ids the catalog offers, at most three. Pure, so the
 * rules are tested without a screen.
 */

export type ChatMode = "auto" | "basic" | "specialists" | "compare";

export const CHAT_MODES: readonly ChatMode[] = [
  "auto",
  "basic",
  "specialists",
  "compare",
];

export const MODE_COPY: Readonly<
  Record<ChatMode, Readonly<{ label: string; line: string }>>
> = {
  auto: {
    label: "Auto",
    line: "One answer: Auto picks the specialist and its model for each question.",
  },
  basic: {
    label: "Basic",
    line: "One answer from one model, with no specialist: the chat's own tools and the sources you turned on.",
  },
  specialists: {
    label: "Specialists",
    line: "One specialist answers, picked for the question; add up to two more. Each runs with its own tools and literature, on its own model or one you pick.",
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
  /** The one plain model Basic sends, or null when none is offered. */
  basic: string | null;
  /**
   * Rows chosen in the Specialists mode: `agent:<id>` on the specialist's
   * own model, or `agent:<id>@<model>` on a model the person picked.
   */
  specialists: readonly string[];
  /** False while Specialists' rows are defaults that follow the question. */
  specialistsChosen: boolean;
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

/** The specialist's own row for a row or a pair: `agent:diet@llama3.2` → `agent:diet`. */
export const specialistOf = (id: string): string => {
  const pair = parsePairedModelId(id);
  return pair === null ? id : `${AGENT_ID_PREFIX}${pair.agentId}`;
};

/**
 * The small line under a picker row: what a specialist runs on and with
 * which tools ("on Qwen3 8B · /sleep tools"; General has no skill, so the
 * chat's own tools), and a model's id or vendor.
 */
export const rowSubline = (row: CatalogModel): string => {
  if (row.id === AUTO_MODEL_ID) return "Picks an agent for each question.";
  if (row.agent !== undefined) {
    return `on ${row.agent.baseModelName} · ${specialistTools(row) ?? ""}`;
  }
  return friendlyModelName(row.id) === null ? row.provider : row.id;
};

/** A specialist's tools as the picker names them, or null for a plain model. */
export const specialistTools = (row: CatalogModel): string | null =>
  row.agent === undefined
    ? null
    : row.agent.skill === null
      ? "chat tools"
      : `/${row.agent.skill} tools`;

/** What Auto runs its pick on, for the Auto panel, or null without Auto. */
export const autoModelName = (context: ModeContext): string | null =>
  findCatalogRow(AUTO_MODEL_ID, context.catalog)?.agent?.baseModelName ?? null;

export const autoOffered = (context: ModeContext): boolean =>
  context.catalog.some((row) => row.id === AUTO_MODEL_ID) &&
  rowRunsHere(AUTO_MODEL_ID, context);

/** Basic needs a plain model; one that does not run here still shows, greyed. */
const basicOffered = (context: ModeContext): boolean =>
  plainModelRows(context.catalog).length > 0;

/** Specialists needs a specialist row; on a hosted provider that is General alone. */
const specialistsOffered = (context: ModeContext): boolean =>
  specialistRows(context.catalog).length > 0;

/**
 * The modes the picker offers: Auto only when the catalog has its row, Basic
 * only when it has a plain model, Specialists only when it has a specialist.
 */
export const offeredModes = (context: ModeContext): readonly ChatMode[] =>
  CHAT_MODES.filter(
    (mode) =>
      (mode !== "auto" || autoOffered(context)) &&
      (mode !== "basic" || basicOffered(context)) &&
      (mode !== "specialists" || specialistsOffered(context)),
  );

const offered = (id: string, context: ModeContext): boolean =>
  findCatalogRow(id, context.catalog) !== null && rowRunsHere(id, context);

/** Compare's default rows, fitted to the question (#493); never Auto. */
export const compareDefaults = (context: ModeContext, prompt = ""): readonly string[] => {
  const rows = context.catalog.filter(
    (row) => row.id !== AUTO_MODEL_ID && rowRunsHere(row.id, context),
  );
  return defaultModelSelection(rows, prompt).slice(0, MAX_SELECTED_MODELS);
};

/**
 * The Specialists mode's default: one answer, to spare the GPU. It is the
 * specialist Auto would pick for the question (`routeAgent`, General when
 * nothing matches), on that specialist's own model; else the first
 * specialist that runs here. The person adds up to two more by hand.
 */
export const specialistDefaults = (
  context: ModeContext,
  prompt = "",
): readonly string[] => {
  const rows = specialistRows(context.catalog).filter((row) =>
    rowRunsHere(row.id, context),
  );
  const routed = `${AGENT_ID_PREFIX}${
    routeAgent(
      prompt,
      rows.flatMap((row) => (row.agent === undefined ? [] : [row.agent.id])),
    ).agentId
  }`;
  const pick = rows.find((row) => row.id === routed) ?? rows[0];
  return pick === undefined ? [] : [pick.id];
};

const firstOf = (rows: readonly CatalogModel[], context: ModeContext): string[] => {
  const first = rows.find((row) => rowRunsHere(row.id, context));
  return first === undefined ? [] : [first.id];
};

/**
 * Basic's default model: the one Auto runs its pick on when that is a plain
 * model that runs here (the model that calls tools most reliably, #379),
 * else the first plain model that runs here.
 */
export const basicDefault = (context: ModeContext): string | null => {
  const autoBase = findCatalogRow(AUTO_MODEL_ID, context.catalog)?.agent?.baseModelId;
  const plain = plainModelRows(context.catalog);
  const preferred = plain.find(
    (row) => row.id === autoBase && rowRunsHere(row.id, context),
  );
  return preferred?.id ?? firstOf(plain, context)[0] ?? null;
};

// --- initial selection ------------------------------------------------------------

const baseState = (context: ModeContext): ModeState => ({
  mode: autoOffered(context) ? "auto" : "compare",
  basic: basicDefault(context),
  specialists: specialistDefaults(context),
  specialistsChosen: false,
  compare: compareDefaults(context),
  compareChosen: false,
  fromThread: false,
});

/**
 * Where the picker starts (SPEC 7.2): a new chat on Auto when offered, else
 * Compare; a reopened thread in the mode and rows of its last turn. No mode
 * is stored, so it is read from the ids: Auto's one row is Auto, one plain
 * model is Basic, specialists only (on their own model or a picked one, as a
 * saved Manual thread has), each once, are Specialists, anything else is
 * Compare, which keeps every row (one specialist on two models, say).
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
  const isSpecialist = (id: string) =>
    findCatalogRow(id, context.catalog)?.agent !== undefined;
  const [only] = live;
  if (ids.length === 1 && only !== undefined && !isSpecialist(only)) {
    return { ...base, mode: "basic", basic: only, fromThread: true };
  }
  const oncePerSpecialist = new Set(live.map(specialistOf)).size === live.length;
  if (live.length > 0 && live.every(isSpecialist) && oncePerSpecialist) {
    return {
      ...base,
      mode: "specialists",
      specialists: live.slice(0, MAX_SELECTED_MODELS),
      specialistsChosen: true,
      fromThread: true,
    };
  }
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

/** Specialists' rows as shown: refitted to the question until chosen. */
export const specialistPicks = (
  state: ModeState,
  context: ModeContext,
  prompt: string,
): readonly string[] =>
  state.specialistsChosen ? state.specialists : specialistDefaults(context, prompt);

/**
 * A specialist as Compare adds it: on the model picked for it in Specialists
 * when that pair is offered here, else on its own model (#859).
 */
const carriedRow = (
  state: ModeState,
  context: ModeContext,
  prompt: string,
  id: string,
): string =>
  specialistPicks(state, context, prompt).find(
    (pick) => specialistOf(pick) === id && offered(pick, context),
  ) ?? id;

/**
 * Compare's rows as shown and sent: refitted to the question until chosen,
 * each default specialist on the model it has in Specialists.
 */
export const compareRows = (
  state: ModeState,
  context: ModeContext,
  prompt: string,
): readonly string[] =>
  state.compareChosen
    ? state.compare
    : compareDefaults(context, prompt).map((id) =>
        carriedRow(state, context, prompt, id),
      );

/** The specialists the Specialists mode sends: its rows the catalog offers here. */
const specialistIds = (
  state: ModeState,
  context: ModeContext,
  prompt: string,
): string[] =>
  specialistPicks(state, context, prompt).filter((id) => offered(id, context));

/** Room for one more specialist in the Specialists mode (at most three). */
export const canAddSpecialist = (
  state: ModeState,
  context: ModeContext,
  prompt: string,
): boolean => specialistIds(state, context, prompt).length < MAX_SELECTED_MODELS;

/** The model a Specialists row runs on: the picked one, else its own. */
export const specialistModel = (id: string, context: ModeContext): string | null => {
  const pair = parsePairedModelId(id);
  if (pair !== null) return pair.modelId;
  return findCatalogRow(id, context.catalog)?.agent?.baseModelId ?? null;
};

/**
 * A specialist's row on a model: its plain `agent:<id>` row on its own
 * model, else the pair `agent:<id>@<model>`.
 */
const rowOnModel = (id: string, modelId: string, context: ModeContext): string => {
  const specialist = specialistOf(id);
  const own = findCatalogRow(specialist, context.catalog)?.agent?.baseModelId;
  return own === modelId
    ? specialist
    : pairedModelId(specialist.slice(AGENT_ID_PREFIX.length), modelId);
};

/** The state with one Specialists row moved to another model. */
export const setSpecialistModel = (
  state: ModeState,
  context: ModeContext,
  prompt: string,
  id: string,
  modelId: string,
): ModeState => {
  const next = rowOnModel(id, modelId, context);
  return {
    ...state,
    specialists: specialistPicks(state, context, prompt).map((each) =>
      each === id ? next : each,
    ),
    specialistsChosen: true,
    fromThread: false,
  };
};

/**
 * The state with one Compare row moved to another model, as
 * `setSpecialistModel` does in Specialists (#859).
 */
export const setCompareModel = (
  state: ModeState,
  context: ModeContext,
  prompt: string,
  id: string,
  modelId: string,
): ModeState => {
  const next = rowOnModel(id, modelId, context);
  const rows = compareRows(state, context, prompt).map((each) =>
    each === id ? next : each,
  );
  return {
    ...state,
    compare: [...new Set(rows)],
    compareChosen: true,
    fromThread: false,
  };
};

/** The model Basic sends: its pick while offered here, else none. */
const basicIds = (state: ModeState, context: ModeContext): string[] =>
  state.basic !== null && offered(state.basic, context) ? [state.basic] : [];

/** How many answers the state asks for, before the cap. */
export const answerCount = (
  state: ModeState,
  context: ModeContext,
  prompt: string,
): number =>
  state.mode === "auto"
    ? 1
    : state.mode === "basic"
      ? basicIds(state, context).length
      : state.mode === "specialists"
        ? specialistIds(state, context, prompt).length
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
  if (state.mode === "basic") {
    return basicIds(state, context).length === 0 ? "Pick a model." : null;
  }
  const count = answerCount(state, context, prompt);
  if (state.mode === "specialists") {
    return count < MIN_SELECTED_MODELS || count > MAX_SELECTED_MODELS
      ? "Pick one to three specialists."
      : null;
  }
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
      : state.mode === "basic"
        ? basicIds(state, context)
        : state.mode === "specialists"
          ? specialistIds(state, context, prompt)
          : compareRows(state, context, prompt);
  const sent = [...new Set(ids)]
    .filter((id) => offered(id, context))
    .slice(0, MAX_SELECTED_MODELS);
  return sent.flatMap((id) => {
    const row = findCatalogRow(id, context.catalog);
    if (row === null) return [];
    const name = turnModelName(
      { id, name: row.name },
      context.catalog,
      prompt,
      sent.length,
    );
    return [{ id, name }];
  });
};

/**
 * The mode pill: "Auto", "Basic · Qwen3 4B", "Specialists · Sleep",
 * "Specialists · 2", "Compare · 3 models".
 */
export const modeSummary = (
  state: ModeState,
  context: ModeContext,
  prompt: string,
): string => {
  if (state.mode === "auto") return MODE_COPY.auto.label;
  if (state.mode === "basic") {
    const [id] = basicIds(state, context);
    const row = id === undefined ? null : findCatalogRow(id, context.catalog);
    return row === null
      ? MODE_COPY.basic.label
      : `${MODE_COPY.basic.label} · ${row.name}`;
  }
  if (state.mode === "specialists") {
    const ids = specialistIds(state, context, prompt);
    const [one] = ids;
    const row =
      ids.length === 1 && one !== undefined ? findCatalogRow(one, context.catalog) : null;
    return row === null
      ? `${MODE_COPY.specialists.label} · ${String(ids.length)}`
      : `${MODE_COPY.specialists.label} · ${row.name}`;
  }
  const count = answerCount(state, context, prompt);
  return `Compare · ${String(count)} ${count === 1 ? "model" : "models"}`;
};

/** The picker's footer: what is missing, else the count. */
export const pickerFooter = (
  state: ModeState,
  context: ModeContext,
  prompt: string,
): string =>
  modeProblem(state, context, prompt) ??
  (state.mode === "auto" || state.mode === "basic"
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

export type PickerList = "basic" | "specialists" | "compare";

/**
 * The ids a list's boxes are checked against. The Specialists boxes stand
 * for specialists, so a pair counts as its specialist.
 */
const listOf = (
  state: ModeState,
  list: PickerList,
  context: ModeContext,
  prompt: string,
): readonly string[] => {
  switch (list) {
    case "basic":
      return state.basic === null ? [] : [state.basic];
    case "specialists":
      return specialistPicks(state, context, prompt).map(specialistOf);
    case "compare":
      return compareRows(state, context, prompt).map(specialistOf);
  }
};

/**
 * The state with one box ticked or unticked; the rule is checked by
 * `boxDisabled`. Basic's list is one choice, so a pick replaces the last. A
 * specialist unticked goes with whichever model it was on. One ticked joins
 * on its own model in Specialists, and in Compare on the model Specialists
 * has for it.
 */
export const toggleRow = (
  state: ModeState,
  list: PickerList,
  id: string,
  context: ModeContext,
  prompt: string,
): ModeState => {
  switch (list) {
    case "basic":
      return { ...state, basic: id, fromThread: false };
    case "specialists": {
      const picks = specialistPicks(state, context, prompt);
      const next = picks.some((each) => specialistOf(each) === id)
        ? picks.filter((each) => specialistOf(each) !== id)
        : [...picks, id];
      return { ...state, specialists: next, specialistsChosen: true, fromThread: false };
    }
    case "compare": {
      const rows = compareRows(state, context, prompt);
      const next = rows.some((each) => specialistOf(each) === id)
        ? rows.filter((each) => specialistOf(each) !== id)
        : [...rows, carriedRow(state, context, prompt, id)];
      return { ...state, compare: next, compareChosen: true, fromThread: false };
    }
  }
};

export const setMode = (state: ModeState, mode: ChatMode): ModeState => ({
  ...state,
  mode,
  fromThread: false,
});

/**
 * Why a box may not change, or null when it may: one more would break the
 * at-most-three rule, one fewer would leave Specialists without a specialist
 * or Compare without a row, or the row does not run on this machine.
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
  if (list === "basic") return null;
  const checked = listOf(state, list, context, prompt).includes(id);
  const next = toggleRow(state, list, id, context, prompt);
  if (checked) {
    if (list === "specialists" && next.specialists.length < MIN_SELECTED_MODELS) {
      return "Keep at least one specialist.";
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
): boolean => listOf(state, list, context, prompt).includes(id);

/**
 * The models a Specialists row may move to, with why one may not: every
 * plain model, a model this incognito chat cannot run greyed out.
 */
export const specialistModelChoices = (
  id: string,
  context: ModeContext,
): readonly Readonly<{ id: string; name: string; reason: string | null }>[] => {
  const specialist = specialistOf(id);
  const own = findCatalogRow(specialist, context.catalog)?.agent?.baseModelId;
  return plainModelRows(context.catalog).map((row) => {
    const runs =
      row.id === own
        ? rowRunsHere(specialist, context)
        : rowRunsHere(
            pairedModelId(specialist.slice(AGENT_ID_PREFIX.length), row.id),
            context,
          );
    return {
      id: row.id,
      name: row.name,
      reason: runs ? null : "Not on this machine, so not for incognito chats.",
    };
  });
};
