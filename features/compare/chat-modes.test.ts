import { describe, expect, test } from "bun:test";

import type { CatalogModel } from "@/infrastructure/model-catalog";

import {
  boxDisabled,
  compareRows,
  droppedModels,
  initialModeState,
  type ModeContext,
  modeProblem,
  modeSummary,
  offeredModes,
  pickedModels,
  pickerFooter,
  setMode,
  toggleRow,
} from "./chat-modes";

const model = (id: string, name: string, providerId = "ollama"): CatalogModel => ({
  id,
  name,
  provider: providerId === "ollama" ? "Ollama" : "Meta",
  providerId,
  contextTokens: 32_000,
});

const agent = (id: string, name: string, base: CatalogModel): CatalogModel => ({
  ...base,
  id: `agent:${id}`,
  name,
  agent: {
    id,
    name,
    role: "A synthetic role.",
    skill: null,
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
    expect(offeredModes(ctx())).toEqual(["auto", "manual", "compare"]);
    expect(pickedModels(state, ctx(), "How did I sleep?")).toEqual([
      { id: "agent:auto", name: "Auto → Sleep" },
    ]);
  });

  test("without the Auto row it starts on Compare, and Auto is not offered", () => {
    const context = ctx({ catalog: CATALOG.slice(1) });
    expect(initialModeState(context, null).mode).toBe("compare");
    expect(offeredModes(context)).toEqual(["manual", "compare"]);
  });

  test("the other modes open on sensible picks, never an empty list", () => {
    const state = initialModeState(ctx(), null);
    expect(state.specialists).toEqual(["agent:gp"]);
    expect(state.models).toEqual(["qwen3:4b"]);
    expect(compareRows(state, ctx(), "").length).toBeGreaterThan(0);
  });
});

describe("a reopened thread starts where its last turn stopped (SPEC 7.2)", () => {
  test("exactly Auto's id: Auto", () => {
    expect(initialModeState(ctx(), ["agent:auto"]).mode).toBe("auto");
  });

  test("a paired id: Manual with that specialist and model", () => {
    const state = initialModeState(ctx(), ["agent:diet@qwen3:8b"]);
    expect(state.mode).toBe("manual");
    expect(state.specialists).toEqual(["agent:diet"]);
    expect(state.models).toEqual(["qwen3:8b"]);
    expect(pickedModels(state, ctx(), "")).toEqual([
      { id: "agent:diet@qwen3:8b", name: "Diet specialist · Qwen3 8B" },
    ]);
  });

  test("one offered id: Manual with its specialist and base model, or the model", () => {
    const specialist = initialModeState(ctx(), ["agent:sleep"]);
    expect([specialist.mode, specialist.specialists, specialist.models]).toEqual([
      "manual",
      ["agent:sleep"],
      ["qwen3:8b"],
    ]);
    const plain = initialModeState(ctx(), ["llama3:8b"]);
    expect([plain.mode, plain.specialists, plain.models]).toEqual([
      "manual",
      [],
      ["llama3:8b"],
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

describe("Manual sends each specialist on each model (SPEC 7.1)", () => {
  const manual = (specialists: string[], models: string[]) => ({
    ...setMode(initialModeState(ctx(), null), "manual"),
    specialists,
    models,
  });

  test("a specialist on its own model sends its plain row, else the pair", () => {
    expect(
      pickedModels(manual(["agent:diet"], ["qwen3:4b", "llama3:8b"]), ctx(), "").map(
        ({ id }) => id,
      ),
    ).toEqual(["agent:diet", "agent:diet@llama3:8b"]);
  });

  test("no specialist: the models answer as themselves", () => {
    expect(
      pickedModels(manual([], ["qwen3:4b", "qwen3:8b"]), ctx(), "").map(({ id }) => id),
    ).toEqual(["qwen3:4b", "qwen3:8b"]);
  });

  test("more than three answers is a problem and the box that would cause it is disabled", () => {
    const state = manual(["agent:diet", "agent:gp"], ["qwen3:4b"]);
    expect(boxDisabled(state, "models", "qwen3:8b", ctx(), "")).toBe(
      "Three answers at most.",
    );
    expect(
      modeProblem(
        manual(["agent:diet", "agent:gp"], ["qwen3:4b", "llama3:8b"]),
        ctx(),
        "",
      ),
    ).toBe("Three answers at most.");
  });

  test("the last model cannot be unticked", () => {
    expect(boxDisabled(manual([], ["qwen3:4b"]), "models", "qwen3:4b", ctx(), "")).toBe(
      "Manual needs at least one model.",
    );
    expect(modeProblem(manual([], []), ctx(), "")).toBe("Pick at least one model.");
  });
});

describe("summary, footer and problems", () => {
  test("the pill names the mode and count", () => {
    const base = initialModeState(ctx(), null);
    expect(modeSummary(base, ctx(), "")).toBe("Auto");
    expect(
      modeSummary(
        {
          ...setMode(base, "manual"),
          specialists: [],
          models: ["qwen3:4b", "llama3:8b"],
        },
        ctx(),
        "",
      ),
    ).toBe("Manual · 2 answers");
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
    expect(
      pickerFooter(
        { ...setMode(base, "manual"), specialists: [], models: ["qwen3:4b"] },
        ctx(),
        "",
      ),
    ).toBe("1 of at most 3 answers.");
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
      "manual",
      "compare",
    ]);
  });
});
