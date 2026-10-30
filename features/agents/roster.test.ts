import { describe, expect, test } from "bun:test";

import { AGENTS } from "@/infrastructure/agents";
import { type CatalogModel } from "@/infrastructure/model-catalog";
import { type TurnSkill } from "@/infrastructure/skill-gate";

import {
  answersText,
  articlesText,
  baseModelScores,
  DOES_NOT,
  HAND_WRITTEN,
  literatureFor,
  NO_USAGE,
  routedText,
  routerAccuracy,
  routingFor,
  routingTotal,
  rosterEntries,
  rosterEntry,
  scenarioOf,
  scoreText,
  shareText,
  toolsText,
  withoutEmptyColumns,
  type ScoredRun,
  topicsFor,
  usageByAgent,
  usageNote,
} from "./roster";
import { HAND_WRITTEN_ITEMS, QUESTION_ITEMS } from "./router-fixtures";

const agent = (id: string) => AGENTS.find((candidate) => candidate.id === id)!;

describe("DOES_NOT", () => {
  test("every agent has a line", () => {
    expect(AGENTS.filter(({ id }) => DOES_NOT[id] === undefined)).toEqual([]);
  });
});

describe("usageByAgent", () => {
  test("adds direct and Auto answers per agent, and Auto's own total", () => {
    const usage = usageByAgent([
      {
        modelId: "agent:sleep",
        modelName: "Sleep",
        answers: 3,
        costUsd: 0,
        lastAt: "2026-10-20T08:00:00.000Z",
      },
      {
        modelId: "agent:auto",
        modelName: "Auto → Sleep",
        answers: 2,
        costUsd: 0.5,
        lastAt: "2026-10-28T08:00:00.000Z",
      },
      {
        modelId: "agent:auto",
        modelName: "Auto",
        answers: 1,
        costUsd: 0,
        lastAt: "2026-10-01T08:00:00.000Z",
      },
      {
        modelId: "qwen3:8b",
        modelName: "Qwen3 8B",
        answers: 9,
        costUsd: 0,
        lastAt: "2026-10-29T08:00:00.000Z",
      },
      {
        modelId: "agent:retired",
        modelName: "Retired",
        answers: 4,
        costUsd: 0,
        lastAt: null,
      },
    ]);
    expect([...usage.entries()]).toEqual([
      [
        "sleep",
        { answers: 5, viaAuto: 2, costUsd: 0.5, lastAt: "2026-10-28T08:00:00.000Z" },
      ],
      [
        "auto",
        { answers: 3, viaAuto: 0, costUsd: 0.5, lastAt: "2026-10-28T08:00:00.000Z" },
      ],
    ]);
  });

  test("no rows, no usage", () => {
    expect(usageByAgent([]).size).toBe(0);
  });
});

describe("answersText", () => {
  test("reads the count and the Auto share", () => {
    expect(answersText(NO_USAGE)).toBe("No answers yet");
    expect(answersText({ ...NO_USAGE, answers: 1 })).toBe("1 answer");
    expect(answersText({ ...NO_USAGE, answers: 1200, viaAuto: 4 })).toBe(
      "1,200 answers, 4 through Auto",
    );
  });
});

describe("scenarioOf", () => {
  test("reads the scenario from a question id", () => {
    expect(scenarioOf({ id: "Q-S3-04" })).toBe("S3");
    expect(scenarioOf({ id: "Q-S12-01" })).toBe("S12");
    expect(scenarioOf({})).toBe(HAND_WRITTEN);
  });
});

describe("routingFor", () => {
  const items = [
    { id: "Q-S1-01", prompt: "How did HbA1c change?", expected: "diet" },
    { id: "Q-S1-02", prompt: "How did my weight change?", expected: "diet" },
    {
      id: "Q-S2-01",
      prompt: "Is the panel of glucose and sodium complete?",
      expected: "gp",
    },
    {
      id: "Q-S5-01",
      prompt: "Should I take more metformin for my HbA1c?",
      expected: "diet",
    },
    { id: "Q-S10-01", prompt: "Where is the liver?", expected: "anatomy" },
    { prompt: "What is my BMI trend?", expected: "diet" },
  ];

  test("counts labelled, routed and strays per scenario, hand-written last", () => {
    expect(routingFor("diet", items)).toEqual([
      { scenario: "S1", labelled: 2, routed: 2, strays: 0 },
      { scenario: "S2", labelled: 0, routed: 0, strays: 1 },
      { scenario: "S5", labelled: 1, routed: 0, strays: 0 },
      { scenario: HAND_WRITTEN, labelled: 1, routed: 1, strays: 0 },
    ]);
  });

  test("the General agent gets the dose question it was not labelled for", () => {
    expect(routingFor("gp", items)).toEqual([
      { scenario: "S2", labelled: 1, routed: 0, strays: 0 },
      { scenario: "S5", labelled: 0, routed: 0, strays: 1 },
    ]);
  });

  test("scenarios sort by number", () => {
    expect(routingFor("anatomy", items)).toEqual([
      { scenario: "S10", labelled: 1, routed: 1, strays: 0 },
    ]);
  });

  test("totals and text", () => {
    const total = routingTotal(routingFor("diet", items));
    expect(total).toEqual({ scenario: "All", labelled: 4, routed: 3, strays: 1 });
    expect(routedText(total)).toBe("3 of 4");
    expect(routedText({ scenario: "S2", labelled: 0, routed: 0, strays: 1 })).toBe("—");
  });
});

describe("routerAccuracy on the committed fixtures", () => {
  test("matches the numbers docs/agents.md gives for version 3", () => {
    expect(routerAccuracy(HAND_WRITTEN_ITEMS)).toEqual({ right: 36, total: 36 });
    expect(routerAccuracy(QUESTION_ITEMS)).toEqual({ right: 126, total: 130 });
  });
});

describe("shareText", () => {
  test("count and share with one decimal", () => {
    expect(shareText(126, 130)).toBe("126 of 130 (96.9%)");
    expect(shareText(36, 36)).toBe("36 of 36 (100.0%)");
    expect(shareText(0, 0)).toBe("0 of 0");
  });
});

describe("baseModelScores", () => {
  const cell = { passes: 19, n: 24, lowPct: 60, highPct: 91 };
  const table = (model: string) => ({
    model,
    columns: ["S1", "All"],
    rows: [
      {
        criterion: "correctness",
        cells: [{ passes: 5, n: 39, lowPct: 6, highPct: 27 }, cell],
      },
    ],
  });
  const runs: readonly ScoredRun[] = [
    {
      id: "mock-run",
      meta: { mock: true, models: [{ provider: "ollama", model_id: "qwen3:8b" }] },
      scores: [table("ollama:qwen3:8b")],
    },
    {
      id: "2026-10-30-qwen3-8b-v1",
      meta: {
        date: "2026-10-30",
        models: [{ provider: "ollama", model_id: "qwen3:8b" }],
      },
      scores: [table("ollama:qwen3:8b")],
    },
    {
      id: "2026-10-30-qwen3-4b-v1",
      meta: {
        date: "2026-10-30",
        models: [{ provider: "ollama", model_id: "qwen3:4b" }],
      },
      scores: [table("ollama:qwen3:4b")],
    },
    {
      id: "no-report",
      meta: { models: [{ provider: "ollama", model_id: "qwen3:8b" }] },
      scores: null,
    },
  ];

  test("keeps real runs of the base model, with its own table", () => {
    expect(baseModelScores(runs, "qwen3:8b")).toEqual([
      {
        runId: "2026-10-30-qwen3-8b-v1",
        date: "2026-10-30",
        ...table("ollama:qwen3:8b"),
      },
    ]);
    expect(baseModelScores(runs, "llama3:8b")).toEqual([]);
    expect(baseModelScores(runs, "qwen3:8b", 0)).toEqual([]);
  });

  test("drops scenario columns no row scored", () => {
    expect(
      withoutEmptyColumns({
        runId: "r",
        date: null,
        model: "ollama:qwen3:8b",
        columns: ["S1", "S7", "All"],
        rows: [
          { criterion: "correctness", cells: [null, cell, cell] },
          { criterion: "privacy", cells: [null, null, cell] },
        ],
      }),
    ).toEqual({
      runId: "r",
      date: null,
      model: "ollama:qwen3:8b",
      columns: ["S7", "All"],
      rows: [
        { criterion: "correctness", cells: [cell, cell] },
        { criterion: "privacy", cells: [null, cell] },
      ],
    });
  });

  test("tools text", () => {
    expect(toolsText(1)).toBe("1 tool");
    expect(toolsText(7)).toBe("7 tools");
  });

  test("score text", () => {
    expect(scoreText({ passes: 21, n: 29, lowPct: 54, highPct: 85 })).toBe(
      "21/29 · 54–85 %",
    );
    expect(scoreText(null)).toBe("—");
  });
});

describe("literatureFor", () => {
  const counts = new Map([
    ["literature:diet", 12],
    ["literature:cardiology", 30],
  ]);

  test("one specialty for a specialist, every one for the General agent", () => {
    expect(literatureFor("diet", counts)).toEqual({
      specialties: ["Diet"],
      articles: 12,
    });
    expect(literatureFor("rhythm", counts)).toEqual({
      specialties: ["Cardiology"],
      articles: 30,
    });
    expect(literatureFor("brain", counts)).toEqual({
      specialties: ["Neurology"],
      articles: 0,
    });
    expect(literatureFor("gp", counts)).toEqual({
      specialties: [
        "General",
        "Diet",
        "Anatomy",
        "Sleep",
        "Trainer",
        "Genetics",
        "Cardiology",
        "Neurology",
      ],
      articles: 42,
    });
  });

  test("an unread index gives no count", () => {
    expect(literatureFor("sleep", null)).toEqual({
      specialties: ["Sleep"],
      articles: null,
    });
  });

  test("articles text", () => {
    expect(articlesText(1)).toBe("1 article");
    expect(articlesText(1500)).toBe("1,500 articles");
    expect(articlesText(null)).toBe("—");
  });
});

describe("topicsFor", () => {
  test("the router's own topics", () => {
    expect(topicsFor("sleep")).toEqual(["sleep"]);
    expect(topicsFor("brain")).toEqual([
      "stroke",
      "cognition and memory",
      "the autonomic nervous system",
    ]);
    expect(topicsFor("gp")).toEqual([
      "a medicine or dose decision",
      "the guideline library",
      "anything no specialist agent here matches",
    ]);
  });
});

describe("rosterEntry", () => {
  const sleepSkill: TurnSkill = {
    name: "sleep",
    description: "Sleep.",
    tools: ["sleep_summary", "knowledge_search"],
    sources: ["wearable-context", "opentwin-knowledge"],
    providers: ["ollama"],
    views: [],
    instructions: "Describe.",
  };
  const base: CatalogModel = {
    id: "qwen3:8b",
    name: "Qwen3 8B",
    provider: "Ollama",
    providerId: "ollama",
    contextTokens: 40_000,
  };
  const catalog: readonly CatalogModel[] = [
    {
      ...base,
      id: "agent:sleep",
      name: "Sleep",
      agent: {
        id: "sleep",
        name: "Sleep",
        role: agent("sleep").role,
        skill: "sleep",
        baseModelId: "qwen3:8b",
        baseModelName: "Qwen3 8B",
      },
    },
    base,
  ];
  const input = {
    catalog,
    skills: [sleepSkill],
    usage: new Map([["sleep", { ...NO_USAGE, answers: 2 }]]),
    literatureCounts: new Map([["literature:sleep", 7]]),
    routerItems: [{ id: "Q-S6-01", prompt: "How did I sleep?", expected: "sleep" }],
  };

  test("an offered agent with its skill, model, literature, topics and usage", () => {
    expect(rosterEntry(agent("sleep"), input)).toEqual({
      id: "sleep",
      name: "Sleep",
      role: agent("sleep").role,
      doesNot: DOES_NOT.sleep!,
      offered: true,
      baseModel: { id: "qwen3:8b", name: "Qwen3 8B" },
      modelPreference: ["qwen3:8b", "qwen3:4b"],
      skillName: "sleep",
      skill: {
        name: "sleep",
        tools: ["sleep_summary", "knowledge_search"],
        sources: ["Your linked wearables", "OpenTwin knowledge notes"],
        localOnly: true,
      },
      literature: { specialties: ["Sleep"], articles: 7 },
      topics: ["sleep"],
      usage: { ...NO_USAGE, answers: 2 },
      routing: [{ scenario: "S6", labelled: 1, routed: 1, strays: 0 }],
    });
  });

  test("an agent the catalog leaves out is listed, not offered, with no base model", () => {
    const trainer = rosterEntry(agent("trainer"), input);
    expect([trainer.offered, trainer.baseModel, trainer.skill, trainer.usage]).toEqual([
      false,
      null,
      null,
      NO_USAGE,
    ]);
  });

  test("every agent is listed, in roster order, without a catalog too", () => {
    expect(rosterEntries({ ...input, catalog: null }).map(({ id }) => id)).toEqual(
      AGENTS.map(({ id }) => id),
    );
  });
});

describe("usageNote", () => {
  test("says why counts are missing", () => {
    expect(usageNote(true, true)).toBeNull();
    expect(usageNote(false, true)).toBe(
      "Sign in to see how often each agent answered in your threads.",
    );
    expect(usageNote(true, false)).toBe("Answer counts could not be read just now.");
  });
});
