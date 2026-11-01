import { describe, expect, test } from "bun:test";

import {
  AUTO_MODEL_ID,
  type CatalogModel,
  withAgents,
} from "@/infrastructure/model-catalog";

import {
  initialEffort,
  initialModelIds,
  initialSelection,
  manualAnswerCount,
  modeModelIds,
  modeProblem,
  modeSummary,
  type ModeSelection,
  plainModels,
  specialistRows,
  toggleCompare,
  toggleManual,
} from "./chat-mode";

/** A synthetic local catalog: two models, the specialists that need no skill or sleep. */
const ollama = (id: string): CatalogModel => ({
  id,
  name: id,
  provider: "Ollama",
  providerId: "ollama",
  contextTokens: 16_384,
});

const CATALOG = withAgents([ollama("qwen3:4b"), ollama("llama3.2")], {
  provider: "ollama",
  chatIsLocal: true,
  skills: [
    { name: "sleep", providers: ["ollama"], sources: [], tools: ["sleep_summary"] },
  ],
});

const MODELS_ONLY = [ollama("qwen3:4b"), ollama("llama3.2"), ollama("mistral")];

const selection = (overrides: Partial<ModeSelection>): ModeSelection => ({
  mode: "auto",
  specialists: [],
  models: [],
  compare: [],
  ...overrides,
});

describe("catalog halves", () => {
  test("specialists leave Auto out; models leave every agent out", () => {
    expect(specialistRows(CATALOG).map((row) => row.id)).toEqual([
      "agent:gp",
      "agent:sleep",
    ]);
    expect(plainModels(CATALOG).map((row) => row.id)).toEqual(["qwen3:4b", "llama3.2"]);
  });
});

describe("modeModelIds (#366)", () => {
  test("Auto is one answer from the Auto row", () => {
    expect(modeModelIds(selection({ mode: "auto" }), CATALOG)).toEqual([AUTO_MODEL_ID]);
    expect(modeModelIds(selection({ mode: "auto" }), MODELS_ONLY)).toEqual([]);
  });

  test("Manual runs each specialist on each model, its own row on its own base", () => {
    expect(
      modeModelIds(
        selection({
          mode: "manual",
          specialists: ["gp"],
          models: ["qwen3:4b", "llama3.2"],
        }),
        CATALOG,
      ),
    ).toEqual(["agent:gp", "agent:gp@llama3.2"]);
    expect(
      modeModelIds(
        selection({ mode: "manual", specialists: ["gp", "sleep"], models: ["llama3.2"] }),
        CATALOG,
      ),
    ).toEqual(["agent:gp@llama3.2", "agent:sleep@llama3.2"]);
  });

  test("Manual without a specialist sends the models as themselves", () => {
    expect(
      modeModelIds(selection({ mode: "manual", models: ["llama3.2"] }), CATALOG),
    ).toEqual(["llama3.2"]);
  });

  test("Compare keeps its rows, never Auto, at most three, only offered ones", () => {
    expect(
      modeModelIds(
        selection({
          mode: "compare",
          compare: [
            AUTO_MODEL_ID,
            "qwen3:4b",
            "gone:1b",
            "agent:sleep",
            "llama3.2",
            "agent:gp",
          ],
        }),
        CATALOG,
      ),
    ).toEqual(["qwen3:4b", "agent:sleep", "llama3.2"]);
  });
});

describe("modeProblem", () => {
  test("says in words what is missing, null when the prompt can go", () => {
    expect(modeProblem(selection({ mode: "auto" }), CATALOG)).toBeNull();
    expect(modeProblem(selection({ mode: "auto" }), MODELS_ONLY)).toBe(
      "Auto needs the specialists, which this server does not offer. Choose Manual or Compare.",
    );
    expect(
      modeProblem(selection({ mode: "compare", compare: ["qwen3:4b"] }), CATALOG),
    ).toBe("Compare needs two or three models.");
    expect(modeProblem(selection({ mode: "manual", specialists: ["gp"] }), CATALOG)).toBe(
      "Pick at least one model.",
    );
    expect(
      modeProblem(
        selection({
          mode: "manual",
          specialists: ["gp", "sleep"],
          models: ["qwen3:4b", "llama3.2"],
        }),
        CATALOG,
      ),
    ).toBe(
      "Three answers is the most one prompt can ask for. Pick fewer specialists or models.",
    );
  });
});

describe("toggleManual", () => {
  const start = selection({ mode: "manual", specialists: ["gp"], models: ["qwen3:4b"] });

  test("adds and removes, keeping at least one model", () => {
    expect(toggleManual(start, "models", "llama3.2").models).toEqual([
      "qwen3:4b",
      "llama3.2",
    ]);
    expect(toggleManual(start, "models", "qwen3:4b")).toEqual(start);
    expect(toggleManual(start, "specialists", "gp").specialists).toEqual([]);
  });

  test("never asks for more than three answers", () => {
    const two = toggleManual(start, "models", "llama3.2");
    expect(toggleManual(two, "specialists", "sleep")).toEqual(two);
    expect(manualAnswerCount(0, 3)).toBe(3);
    expect(manualAnswerCount(2, 2)).toBe(4);
  });
});

describe("initialSelection", () => {
  test("a new chat starts in Auto, with Manual and Compare ready to switch to", () => {
    expect(initialSelection([], CATALOG)).toEqual({
      mode: "auto",
      specialists: ["gp"],
      models: ["qwen3:4b"],
      compare: ["agent:gp", "qwen3:4b", "llama3.2"],
    });
  });

  test("without specialists a new chat starts in Compare", () => {
    expect(initialSelection([], MODELS_ONLY).mode).toBe("compare");
  });

  test("a thread reopens in the mode its last ids say", () => {
    expect(initialSelection([AUTO_MODEL_ID], CATALOG).mode).toBe("auto");
    expect(initialSelection(["agent:gp", "agent:gp@llama3.2"], CATALOG)).toMatchObject({
      mode: "manual",
      specialists: ["gp"],
      models: ["qwen3:4b", "llama3.2"],
    });
    expect(initialSelection(["agent:sleep"], CATALOG)).toMatchObject({
      mode: "manual",
      specialists: ["sleep"],
      models: ["qwen3:4b"],
    });
    expect(initialSelection(["llama3.2"], CATALOG)).toMatchObject({
      mode: "manual",
      specialists: [],
      models: ["llama3.2"],
    });
    expect(initialSelection(["agent:gp", "llama3.2", "gone:1b"], CATALOG)).toMatchObject({
      mode: "compare",
      compare: ["agent:gp", "llama3.2"],
    });
  });
});

describe("toggleCompare", () => {
  const two = selection({ mode: "compare", compare: ["qwen3:4b", "llama3.2"] });

  test("adds up to three, keeps one, never adds Auto", () => {
    expect(toggleCompare(two, "agent:gp", CATALOG).compare).toEqual([
      "qwen3:4b",
      "llama3.2",
      "agent:gp",
    ]);
    const three = toggleCompare(two, "agent:gp", CATALOG);
    expect(toggleCompare(three, "agent:sleep", CATALOG)).toEqual(three);
    const one = toggleCompare(two, "llama3.2", CATALOG);
    expect(one.compare).toEqual(["qwen3:4b"]);
    expect(toggleCompare(one, "qwen3:4b", CATALOG)).toEqual(one);
    expect(toggleCompare(two, AUTO_MODEL_ID, CATALOG)).toEqual(two);
  });
});

describe("modeSummary", () => {
  test("names the mode and how many answers it asks for", () => {
    expect(modeSummary(selection({ mode: "auto" }), CATALOG)).toBe("Auto");
    expect(
      modeSummary(
        selection({
          mode: "manual",
          specialists: ["gp"],
          models: ["qwen3:4b", "llama3.2"],
        }),
        CATALOG,
      ),
    ).toBe("Manual · 2 answers");
    expect(
      modeSummary(selection({ mode: "manual", models: ["llama3.2"] }), CATALOG),
    ).toBe("Manual · 1 answer");
    expect(
      modeSummary(
        selection({ mode: "compare", compare: ["qwen3:4b", "llama3.2"] }),
        CATALOG,
      ),
    ).toBe("Compare · 2 models");
  });
});

describe("initialEffort (#379)", () => {
  const answer = (level: "quick" | "balanced" | "ultra" | null) => ({
    document:
      level === null
        ? null
        : { effort: { level, thinking: "on", max_steps: 12, review: false } },
  });

  test("a reopened thread starts at its last turn's effort", () => {
    expect(
      initialEffort([
        { answers: [answer("quick")] },
        { answers: [answer(null), answer("ultra")] },
      ]),
    ).toBe("ultra");
  });

  test("a turn sent in this tab, a turn from before effort and a new chat", () => {
    expect(initialEffort([{ effort: "quick", answers: [answer(null)] }])).toBe("quick");
    expect(initialEffort([{ answers: [answer(null)] }])).toBe("balanced");
    expect(initialEffort([])).toBe("balanced");
  });
});

describe("a new chat and a reopened thread (#386)", () => {
  const turn = (ids: readonly string[], level: "quick" | "deep" | null = null) => ({
    answers: ids.map((modelId) => ({
      modelId,
      document: level === null ? null : { effort: { level } },
    })),
  });
  const opening = (turns: readonly ReturnType<typeof turn>[]) => ({
    mode: initialSelection(initialModelIds(turns), CATALOG).mode,
    effort: initialEffort(turns),
  });

  test("a new chat opens in Auto at Balanced", () => {
    expect(initialModelIds([])).toEqual([]);
    expect(opening([])).toEqual({ mode: "auto", effort: "balanced" });
  });

  test("a thread reopens in the mode and effort of its last turn", () => {
    expect(
      opening([turn(["qwen3:4b", "llama3.2"], "deep"), turn([AUTO_MODEL_ID])]),
    ).toEqual({ mode: "auto", effort: "balanced" });
    expect(
      opening([turn([AUTO_MODEL_ID]), turn(["qwen3:4b", "llama3.2"], "deep")]),
    ).toEqual({ mode: "compare", effort: "deep" });
    expect(
      opening([turn([AUTO_MODEL_ID]), turn(["agent:gp@llama3.2"], "quick")]),
    ).toEqual({
      mode: "manual",
      effort: "quick",
    });
  });
});
