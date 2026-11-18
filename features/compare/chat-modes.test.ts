import { describe, expect, test } from "bun:test";

import type { CatalogModel } from "@/infrastructure/model-catalog";

import {
  autoModelName,
  boxChecked,
  boxDisabled,
  canAddSpecialist,
  compareRows,
  droppedModels,
  initialModeState,
  specialistPicks,
  type ModeContext,
  type ModeState,
  modeProblem,
  modeSummary,
  offeredModes,
  pickedModels,
  pickerFooter,
  rowSubline,
  setCompareModel,
  setMode,
  setSpecialistModel,
  specialistModel,
  specialistModelChoices,
  toggleRow,
} from "./chat-modes";

const model = (id: string, name: string, providerId = "ollama"): CatalogModel => ({
  id,
  name,
  provider: providerId === "ollama" ? "Ollama" : "Meta",
  providerId,
  contextTokens: 32_000,
});

const agent = (
  id: string,
  name: string,
  base: CatalogModel,
  skill: string | null = null,
): CatalogModel => ({
  ...base,
  id: `agent:${id}`,
  name,
  agent: {
    id,
    name,
    role: "A synthetic role.",
    skill,
    baseModelId: base.id,
    baseModelName: base.name,
  },
});

const SMALL = model("qwen3:4b", "Qwen3 4B");
const LARGE = model("qwen3:8b", "Qwen3 8B");
const META = model("llama3:8b", "Llama 3 8B", "meta");

const CATALOG: readonly CatalogModel[] = [
  agent("auto", "Auto", SMALL),
  agent("gp", "General", LARGE),
  agent("diet", "Diet specialist", SMALL),
  agent("sleep", "Sleep", LARGE),
  SMALL,
  LARGE,
  META,
];

const ctx = (over: Partial<ModeContext> = {}): ModeContext => ({
  catalog: CATALOG,
  incognito: false,
  localModelIds: CATALOG.map(({ id }) => id),
  ...over,
});

describe("modes offered and the new chat (SPEC 7.1, 7.2)", () => {
  test("a new chat starts on Auto when the catalog has it", () => {
    const state = initialModeState(ctx(), null);
    expect(state.mode).toBe("auto");
    expect(offeredModes(ctx())).toEqual(["auto", "basic", "specialists", "compare"]);
    expect(pickedModels(state, ctx(), "How did I sleep?")).toEqual([
      { id: "agent:auto", name: "Auto → Sleep" },
    ]);
  });

  test("without the Auto row it starts on Compare, and Auto is not offered", () => {
    const context = ctx({ catalog: CATALOG.slice(1) });
    expect(initialModeState(context, null).mode).toBe("compare");
    expect(offeredModes(context)).toEqual(["basic", "specialists", "compare"]);
  });
});

describe("a reopened thread starts where its last turn stopped (SPEC 7.2)", () => {
  test("exactly Auto's id: Auto", () => {
    expect(initialModeState(ctx(), ["agent:auto"]).mode).toBe("auto");
  });

  test("a saved Manual thread: Specialists on the same specialist and model", () => {
    const state = initialModeState(ctx(), ["agent:diet@qwen3:8b", "agent:sleep"]);
    expect(state.mode).toBe("specialists");
    expect(pickedModels(state, ctx(), "")).toEqual([
      { id: "agent:diet@qwen3:8b", name: "Diet specialist · Qwen3 8B" },
      { id: "agent:sleep", name: "Sleep · Qwen3 8B" },
    ]);
  });

  test("one specialist on two models: Compare, so no answer is lost", () => {
    const state = initialModeState(ctx(), ["agent:diet", "agent:diet@qwen3:8b"]);
    expect([state.mode, compareRows(state, ctx(), "")]).toEqual([
      "compare",
      ["agent:diet", "agent:diet@qwen3:8b"],
    ]);
  });

  test("one plain model: Basic on that model (#610)", () => {
    const plain = initialModeState(ctx(), ["llama3:8b"]);
    expect([plain.mode, plain.basic, plain.fromThread]).toEqual([
      "basic",
      "llama3:8b",
      true,
    ]);
    expect(pickedModels(plain, ctx(), "").map(({ id }) => id)).toEqual(["llama3:8b"]);
  });

  test("specialists only: Specialists with those rows, kept as chosen (#610)", () => {
    const one = initialModeState(ctx(), ["agent:sleep"]);
    expect([one.mode, specialistPicks(one, ctx(), "Is my BMI going up?")]).toEqual([
      "specialists",
      ["agent:sleep"],
    ]);
    const two = initialModeState(ctx(), ["agent:gp", "agent:diet", "agent:gone"]);
    expect([two.mode, specialistPicks(two, ctx(), "How did I sleep?")]).toEqual([
      "specialists",
      ["agent:gp", "agent:diet"],
    ]);
  });

  test("specialists and models together: Compare", () => {
    const state = initialModeState(ctx(), ["agent:gp", "llama3:8b"]);
    expect([state.mode, compareRows(state, ctx(), "")]).toEqual([
      "compare",
      ["agent:gp", "llama3:8b"],
    ]);
  });

  test("several offered ids: Compare with those rows, kept as chosen", () => {
    const state = initialModeState(ctx(), ["qwen3:4b", "llama3:8b", "gone:1b"]);
    expect(state.mode).toBe("compare");
    expect(compareRows(state, ctx(), "anything about sleep")).toEqual([
      "qwen3:4b",
      "llama3:8b",
    ]);
  });

  test("none offered any more: Auto when offered", () => {
    expect(initialModeState(ctx(), ["gone:1b", "gone:2b"]).mode).toBe("auto");
  });
});

describe("Compare defaults follow the question until a row is ticked (SPEC 7.3)", () => {
  test("refitted while typing: General, then the ranked specialist", () => {
    const state = setMode(initialModeState(ctx(), null), "compare");
    expect(compareRows(state, ctx(), "How long did I sleep last night?")[0]).toBe(
      "agent:gp",
    );
    expect(compareRows(state, ctx(), "How long did I sleep last night?")).toContain(
      "agent:sleep",
    );
    expect(compareRows(state, ctx(), "Is my BMI going up?")).toContain("agent:diet");
  });

  test("once the person unticks a row, the rows stay", () => {
    const start = setMode(initialModeState(ctx(), null), "compare");
    const prompt = "How long did I sleep?";
    const [first] = compareRows(start, ctx(), prompt);
    const changed = toggleRow(start, "compare", first ?? "", ctx(), prompt);
    expect(compareRows(changed, ctx(), "Is my BMI going up?")).toEqual(
      compareRows(changed, ctx(), prompt),
    );
    expect(compareRows(changed, ctx(), prompt)).not.toContain(first);
  });
});

describe("Basic sends one plain model (#610)", () => {
  const basic = (context = ctx()) => setMode(initialModeState(context, null), "basic");

  test("it starts on Auto's model, with no specialist", () => {
    const state = basic();
    expect(state.basic).toBe("qwen3:4b");
    expect(pickedModels(state, ctx(), "How did I sleep?")).toEqual([
      { id: "qwen3:4b", name: "Qwen3 4B" },
    ]);
    expect(modeSummary(state, ctx(), "")).toBe("Basic · Qwen3 4B");
    expect(pickerFooter(state, ctx(), "")).toBe("One answer per prompt.");
  });

  test("without Auto, the first plain model that runs here", () => {
    const noAuto = ctx({ catalog: CATALOG.slice(1) });
    expect(basic(noAuto).basic).toBe("qwen3:4b");
    const incognito = ctx({ incognito: true, localModelIds: ["llama3:8b"] });
    expect(basic(incognito).basic).toBe("llama3:8b");
  });

  test("picking a model replaces the last; a specialist is never sent", () => {
    const state = toggleRow(basic(), "basic", "llama3:8b", ctx(), "");
    expect(pickedModels(state, ctx(), "").map(({ id }) => id)).toEqual(["llama3:8b"]);
    expect(boxDisabled(state, "basic", "qwen3:8b", ctx(), "")).toBeNull();
  });

  test("a model that is gone or not on this machine cannot be sent", () => {
    expect(modeProblem({ ...basic(), basic: "gone:1b" }, ctx(), "")).toBe(
      "Pick a model.",
    );
    const incognito = ctx({ incognito: true, localModelIds: ["qwen3:4b"] });
    expect(boxDisabled(basic(incognito), "basic", "llama3:8b", incognito, "")).toBe(
      "Not on this machine, so not for incognito chats.",
    );
  });

  test("offered only when the catalog has a plain model", () => {
    const agentsOnly = ctx({ catalog: CATALOG.slice(0, 4) });
    expect(offeredModes(agentsOnly)).toEqual(["auto", "specialists", "compare"]);
  });
});

describe("Specialists sends specialists on their own models (#610)", () => {
  const specialists = (context = ctx()) =>
    setMode(initialModeState(context, null), "specialists");
  const ids = (state: ModeState, prompt = "", context = ctx()) =>
    pickedModels(state, context, prompt).map(({ id }) => id);

  test("one answer by default: the specialist Auto would pick, else General", () => {
    const state = specialists();
    expect(ids(state)).toEqual(["agent:gp"]);
    expect(modeSummary(state, ctx(), "")).toBe("Specialists · General");
    expect(pickerFooter(state, ctx(), "")).toBe("1 of at most 3 answers.");
    expect(ids(state, "How long did I sleep last night?")).toEqual(["agent:sleep"]);
    expect(ids(state, "Is my BMI going up?")).toEqual(["agent:diet"]);
  });

  test("in incognito, the first specialist that runs here", () => {
    const local = ctx({ incognito: true, localModelIds: ["agent:diet"] });
    expect(ids(specialists(local), "How long did I sleep?", local)).toEqual([
      "agent:diet",
    ]);
  });

  test("never a plain model, never Auto", () => {
    const sent = ids(specialists(), "How did I sleep?");
    expect(sent.every((id) => id.startsWith("agent:") && id !== "agent:auto")).toBe(true);
  });

  test("adding: up to three, then no room; the last one stays", () => {
    const start = specialists();
    expect(canAddSpecialist(start, ctx(), "")).toBe(true);
    const two = toggleRow(start, "specialists", "agent:sleep", ctx(), "");
    expect(ids(two, "Is my BMI going up?")).toEqual(["agent:gp", "agent:sleep"]);
    expect(modeSummary(two, ctx(), "")).toBe("Specialists · 2");
    const three = toggleRow(two, "specialists", "agent:diet", ctx(), "");
    expect(ids(three)).toEqual(["agent:gp", "agent:sleep", "agent:diet"]);
    expect(canAddSpecialist(three, ctx(), "")).toBe(false);
    const four = ctx({
      catalog: [...CATALOG, agent("anatomy", "Anatomy specialist", LARGE)],
    });
    expect(boxDisabled(three, "specialists", "agent:anatomy", four, "")).toBe(
      "Three answers at most.",
    );
    expect(boxDisabled(start, "specialists", "agent:gp", ctx(), "")).toBe(
      "Keep at least one specialist.",
    );
    expect(modeProblem({ ...two, specialists: [] }, ctx(), "")).toBe(
      "Pick one to three specialists.",
    );
  });

  test("offered only when the catalog has a specialist", () => {
    const modelsOnly = ctx({ catalog: CATALOG.slice(4) });
    expect(offeredModes(modelsOnly)).toEqual(["basic", "compare"]);
  });
});

describe("a specialist on a model the person picks (#610, was Manual)", () => {
  const start = setMode(initialModeState(ctx(), null), "specialists");
  const ids = (state: ModeState) => pickedModels(state, ctx(), "").map(({ id }) => id);

  test("its own model by default; another model makes the pair", () => {
    expect(specialistModel("agent:gp", ctx())).toBe("qwen3:8b");
    const moved = setSpecialistModel(start, ctx(), "", "agent:gp", "llama3:8b");
    expect(ids(moved)).toEqual(["agent:gp@llama3:8b"]);
    expect(specialistModel("agent:gp@llama3:8b", ctx())).toBe("llama3:8b");
    expect(pickedModels(moved, ctx(), "")[0]?.name).toBe("General · Llama 3 8B");
    expect(modeSummary(moved, ctx(), "")).toBe("Specialists · General · Llama 3 8B");
  });

  test("back on its own model it is the plain row again", () => {
    const moved = setSpecialistModel(start, ctx(), "", "agent:gp", "llama3:8b");
    const back = setSpecialistModel(moved, ctx(), "", "agent:gp@llama3:8b", "qwen3:8b");
    expect(ids(back)).toEqual(["agent:gp"]);
  });

  test("a moved specialist still counts as itself: ticked, and unticked with its model", () => {
    const moved = setSpecialistModel(start, ctx(), "", "agent:gp", "llama3:8b");
    const two = toggleRow(moved, "specialists", "agent:sleep", ctx(), "");
    expect(boxChecked(two, "specialists", "agent:gp", ctx(), "")).toBe(true);
    expect(ids(toggleRow(two, "specialists", "agent:gp", ctx(), ""))).toEqual([
      "agent:sleep",
    ]);
  });

  test("the models offered, greyed in incognito when the pair cannot run here", () => {
    expect(specialistModelChoices("agent:gp", ctx()).map(({ id }) => id)).toEqual([
      "qwen3:4b",
      "qwen3:8b",
      "llama3:8b",
    ]);
    const local = ctx({ incognito: true, localModelIds: ["agent:gp", "qwen3:8b"] });
    expect(
      specialistModelChoices("agent:gp", local).map(({ id, reason }) => [id, reason]),
    ).toEqual([
      ["qwen3:4b", "Not on this machine, so not for incognito chats."],
      ["qwen3:8b", null],
      ["llama3:8b", "Not on this machine, so not for incognito chats."],
    ]);
  });
});

describe("a Compare specialist on a model the person picks (#859)", () => {
  const prompt = "How long did I sleep?";
  const compare = (rows: readonly string[]): ModeState => ({
    ...setMode(initialModeState(ctx(), null), "compare"),
    compare: rows,
    compareChosen: true,
  });
  const sent = (state: ModeState) => pickedModels(state, ctx(), prompt);

  test("its own model by default; another model makes the pair, named in its column", () => {
    const moved = setCompareModel(
      compare(["agent:gp", "qwen3:4b"]),
      ctx(),
      prompt,
      "agent:gp",
      "qwen3:4b",
    );
    expect(sent(moved)).toEqual([
      { id: "agent:gp@qwen3:4b", name: "General · Qwen3 4B" },
      { id: "qwen3:4b", name: "Qwen3 4B" },
    ]);
    expect(boxChecked(moved, "compare", "agent:gp", ctx(), prompt)).toBe(true);
  });

  test("back on its own model it is the plain row again", () => {
    const moved = setCompareModel(
      compare(["agent:gp", "qwen3:4b"]),
      ctx(),
      prompt,
      "agent:gp",
      "llama3:8b",
    );
    const back = setCompareModel(moved, ctx(), prompt, "agent:gp@llama3:8b", "qwen3:8b");
    expect(compareRows(back, ctx(), prompt)).toEqual(["agent:gp", "qwen3:4b"]);
  });

  test("unticked, it goes with whichever model it was on", () => {
    const moved = setCompareModel(
      compare(["agent:gp", "agent:sleep", "qwen3:4b"]),
      ctx(),
      prompt,
      "agent:gp",
      "qwen3:4b",
    );
    const off = toggleRow(moved, "compare", "agent:gp", ctx(), prompt);
    expect(compareRows(off, ctx(), prompt)).toEqual(["agent:sleep", "qwen3:4b"]);
  });

  test("a model picked in Specialists carries into Compare", () => {
    const specialists = setSpecialistModel(
      setMode(initialModeState(ctx(), null), "specialists"),
      ctx(),
      "",
      "agent:gp",
      "qwen3:4b",
    );
    const inCompare = setMode(specialists, "compare");
    expect(compareRows(inCompare, ctx(), prompt)[0]).toBe("agent:gp@qwen3:4b");
    const ticked = toggleRow(
      { ...inCompare, compare: ["qwen3:4b"], compareChosen: true },
      "compare",
      "agent:gp",
      ctx(),
      prompt,
    );
    expect(sent(ticked).map(({ name }) => name)).toEqual([
      "Qwen3 4B",
      "General · Qwen3 4B",
    ]);
  });

  test("a Specialists pick that cannot run in incognito leaves the specialist on its own model", () => {
    const local = ctx({
      incognito: true,
      localModelIds: ["agent:gp", "qwen3:8b", "qwen3:4b"],
    });
    const specialists = setSpecialistModel(
      setMode(initialModeState(ctx(), null), "specialists"),
      ctx(),
      "",
      "agent:gp",
      "llama3:8b",
    );
    const ticked = toggleRow(
      { ...setMode(specialists, "compare"), compare: ["qwen3:4b"], compareChosen: true },
      "compare",
      "agent:gp",
      local,
      prompt,
    );
    expect(compareRows(ticked, local, prompt)).toEqual(["qwen3:4b", "agent:gp"]);
  });
});

describe("each row names its model and tools (#610)", () => {
  test("a specialist names its model and its skill's tools", () => {
    expect(rowSubline(agent("sleep", "Sleep", LARGE, "sleep"))).toBe(
      "on Qwen3 8B · /sleep tools",
    );
  });

  test("General has no skill, so the chat's own tools", () => {
    expect(rowSubline(agent("gp", "General", LARGE))).toBe("on Qwen3 8B · chat tools");
  });

  test("a model names its id, Auto what it does", () => {
    expect(rowSubline(SMALL)).toBe("Ollama");
    expect(rowSubline(agent("auto", "Auto", SMALL))).toBe(
      "Picks an agent for each question.",
    );
  });

  test("Auto's panel names the model Auto runs its pick on", () => {
    expect(autoModelName(ctx())).toBe("Qwen3 4B");
    expect(autoModelName(ctx({ catalog: CATALOG.slice(1) }))).toBeNull();
  });
});

describe("summary, footer and problems", () => {
  test("the pill names the mode and count", () => {
    const base = initialModeState(ctx(), null);
    expect(modeSummary(base, ctx(), "")).toBe("Auto");
    expect(
      modeSummary(
        {
          ...setMode(base, "compare"),
          compare: ["qwen3:4b", "llama3:8b", "agent:gp"],
          compareChosen: true,
        },
        ctx(),
        "",
      ),
    ).toBe("Compare · 3 models");
  });

  test("Compare with one row cannot send", () => {
    const state = {
      ...setMode(initialModeState(ctx(), null), "compare"),
      compare: ["qwen3:4b"],
      compareChosen: true,
    };
    expect(modeProblem(state, ctx(), "")).not.toBeNull();
    expect(boxDisabled(state, "compare", "qwen3:4b", ctx(), "")).toBe(
      "Compare needs at least one row.",
    );
  });

  test("the footer counts the answers", () => {
    const base = initialModeState(ctx(), null);
    expect(pickerFooter(base, ctx(), "")).toBe("One answer per prompt.");
    expect(pickerFooter(setMode(base, "specialists"), ctx(), "")).toBe(
      "1 of at most 3 answers.",
    );
  });

  test("a specialist on its own model names that model beside another answer (#859)", () => {
    const state = {
      ...setMode(initialModeState(ctx(), null), "compare"),
      compare: ["agent:gp", "qwen3:4b"],
      compareChosen: true,
    };
    expect(pickedModels(state, ctx(), "")).toEqual([
      { id: "agent:gp", name: "General · Qwen3 8B" },
      { id: "qwen3:4b", name: "Qwen3 4B" },
    ]);
  });

  test("only offered ids are sent, at most three", () => {
    const state = {
      ...setMode(initialModeState(ctx(), null), "compare"),
      compare: ["gone:1b", "qwen3:4b", "qwen3:8b", "llama3:8b", "agent:gp"],
      compareChosen: true,
    };
    expect(pickedModels(state, ctx(), "").map(({ id }) => id)).toEqual([
      "qwen3:4b",
      "qwen3:8b",
      "llama3:8b",
    ]);
  });

  test("dropped models are counted for the hint", () => {
    expect(droppedModels(["gone:1b", "qwen3:4b"], ctx())).toEqual({
      dropped: 1,
      remaining: 1,
    });
    expect(droppedModels(null, ctx())).toEqual({ dropped: 0, remaining: 0 });
  });
});

describe("incognito offers local models only (SPEC 7.4, 7.8)", () => {
  test("a model not on this machine stays listed but cannot be ticked or sent", () => {
    const context = ctx({ incognito: true, localModelIds: ["qwen3:4b", "agent:auto"] });
    const state = {
      ...setMode(initialModeState(context, null), "compare"),
      compare: ["qwen3:4b", "llama3:8b"],
      compareChosen: true,
    };
    expect(boxDisabled(state, "compare", "llama3:8b", context, "")).toBe(
      "Not on this machine, so not for incognito chats.",
    );
    expect(pickedModels(state, context, "").map(({ id }) => id)).toEqual(["qwen3:4b"]);
  });

  test("Auto is offered only when its model runs here", () => {
    expect(offeredModes(ctx({ incognito: true, localModelIds: [] }))).toEqual([
      "basic",
      "specialists",
      "compare",
    ]);
  });
});
