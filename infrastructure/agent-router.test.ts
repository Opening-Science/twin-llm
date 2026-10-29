import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  agentIdOfAutoColumn,
  autoChoiceLine,
  autoChoiceLineFor,
  autoColumnName,
  DEFAULT_AGENT_TOPICS,
  ROUTE_TOPICS,
  routeAgent,
} from "./agent-router";
import { AGENTS } from "./agents";

const ALL = AGENTS.map(({ id }) => id);

type FixtureItem = Readonly<{
  id?: string;
  prompt: string;
  expected: string;
  rule?: string;
}>;
type Fixture = Readonly<{ items: readonly FixtureItem[] }>;

const readFixture = (name: string): Fixture =>
  JSON.parse(
    readFileSync(join(import.meta.dir, "..", "evaluation", name), "utf8"),
  ) as Fixture;

const FIXTURE = readFixture("agent-router.v1.json");
const QUESTIONS_FIXTURE = readFixture("agent-router.questions.v1.json");

type Miss = FixtureItem & Readonly<{ routed: string }>;

const missesOf = (fixture: Fixture): readonly Miss[] =>
  fixture.items
    .map((item) => ({ ...item, routed: routeAgent(item.prompt, ALL).agentId }))
    .filter(({ routed, expected }) => routed !== expected);

const accuracyOf = (fixture: Fixture): number =>
  1 - missesOf(fixture).length / fixture.items.length;

const report = (name: string, fixture: Fixture): void => {
  const misses = missesOf(fixture);
  const right = fixture.items.length - misses.length;
  console.log(
    `${name}: ${right}/${fixture.items.length} routed as expected (${(accuracyOf(fixture) * 100).toFixed(1)}%)`,
  );
  misses.forEach(({ id, prompt, expected, routed, rule }) =>
    console.log(
      `  miss ${id ?? ""} expected ${expected} (${rule ?? "hand label"}), routed ${routed}: ${prompt}`,
    ),
  );
};

describe("routeAgent", () => {
  test("a diet question goes to the Diet specialist, with the topic it matched", () => {
    expect(routeAgent("How has my body weight changed?", ALL)).toEqual({
      agentId: "diet",
      topic: "body weight",
    });
  });

  test("a LOINC code alone is enough", () => {
    expect(routeAgent("Latest 4548-4 please", ALL)).toEqual({
      agentId: "diet",
      topic: "HbA1c",
    });
    expect(routeAgent("Chart 93832-4", ALL).agentId).toBe("sleep");
  });

  test("no rule matches: the General agent, with no topic", () => {
    expect(routeAgent("Summarise my record.", ALL)).toEqual({
      agentId: "gp",
      topic: null,
    });
  });

  test("the agent with more matching topics wins", () => {
    expect(routeAgent("Recovery, HRV and sleep this week", ALL).agentId).toBe("trainer");
  });

  test("a tie goes to the agent listed first", () => {
    expect(routeAgent("sleep and genome", ALL).agentId).toBe("sleep");
  });

  test("an agent that is not offered is never picked", () => {
    expect(routeAgent("How did I sleep?", ["gp", "diet"])).toEqual({
      agentId: "gp",
      topic: null,
    });
  });

  test("heart rate is not the heart as an organ", () => {
    expect(routeAgent("Where is the heart?", ALL).agentId).toBe("anatomy");
    expect(routeAgent("What is my resting heart rate?", ALL).agentId).toBe("trainer");
  });

  test("a medicine or dose decision goes to the General agent, whatever it names", () => {
    expect(routeAgent("What statin dose fits, given my latest LDL?", ALL)).toEqual({
      agentId: "gp",
      topic: "a medicine or dose decision",
    });
    expect(
      routeAgent("Should I stop the tablets now my glucose is lower?", ALL).agentId,
    ).toBe("gp");
    expect(routeAgent("How many units of insulin do I need?", ALL).agentId).toBe("gp");
  });

  test("reading the record about a medicine is not a medicine or dose decision", () => {
    expect(
      routeAgent(
        "LDL cholesterol before and after atorvastatin 40 MG was first requested",
        ALL,
      ).agentId,
    ).toBe("diet");
    expect(routeAgent("Should I train hard today?", ALL).agentId).toBe("trainer");
  });

  test("a disease named after an organ is not anatomy", () => {
    expect(
      routeAgent("eGFR since the onset of chronic kidney disease", ALL).agentId,
    ).toBe("gp");
    expect(routeAgent("Where are the kidneys?", ALL).agentId).toBe("anatomy");
  });

  test("a sport is training, running a query is not", () => {
    expect(routeAgent("How many minutes per week did I swim?", ALL).agentId).toBe(
      "trainer",
    );
    expect(routeAgent("Cycling minutes per week", ALL).agentId).toBe("trainer");
    expect(routeAgent("Did I record a run on Monday?", ALL).agentId).toBe("trainer");
    expect(routeAgent("Write and run a SQL query.", ALL).agentId).toBe("gp");
  });

  test("the General agent's own topics come back on its line", () => {
    expect(DEFAULT_AGENT_TOPICS.length).toBeGreaterThan(0);
    expect(autoChoiceLineFor("What dose of metformin?", "Auto → General")).toBe(
      "Auto chose General: the question is about a medicine or dose decision.",
    );
  });

  test("every agent but the General agent has rules, and only real agents do", () => {
    expect(Object.keys(ROUTE_TOPICS).sort()).toEqual(
      ALL.filter((id) => id !== "gp").sort(),
    );
  });
});

describe("router evaluation (evaluation/agent-router.v1.json)", () => {
  test("has at least 20 prompts, each naming a real agent", () => {
    expect(FIXTURE.items.length).toBeGreaterThanOrEqual(20);
    FIXTURE.items.forEach(({ expected }) => expect(ALL).toContain(expected));
  });

  test("covers every agent", () => {
    expect(new Set(FIXTURE.items.map(({ expected }) => expected))).toEqual(new Set(ALL));
  });

  test("routes at least 90% of the prompts to the expected agent", () => {
    report("agent-router.v1.json", FIXTURE);
    expect(accuracyOf(FIXTURE)).toBeGreaterThanOrEqual(0.9);
  });
});

describe("router evaluation on the scored questions (evaluation/agent-router.questions.v1.json)", () => {
  test("has one item per scored question, each naming a real agent and its rule", () => {
    expect(QUESTIONS_FIXTURE.items.length).toBe(130);
    QUESTIONS_FIXTURE.items.forEach(({ expected, rule }) => {
      expect(ALL).toContain(expected);
      expect(rule ?? "").not.toBe("");
    });
  });

  test("routes at least 95% of the questions to the agent their tools and codes name", () => {
    report("agent-router.questions.v1.json", QUESTIONS_FIXTURE);
    expect(accuracyOf(QUESTIONS_FIXTURE)).toBeGreaterThanOrEqual(0.95);
  });
});

describe("Auto's column name and line", () => {
  test("column name and back", () => {
    expect(autoColumnName("Diet specialist")).toBe("Auto → Diet specialist");
    expect(agentIdOfAutoColumn("Auto → Diet specialist")).toBe("diet");
    expect(agentIdOfAutoColumn("Auto → Oncology")).toBeNull();
    expect(agentIdOfAutoColumn("Diet specialist")).toBeNull();
  });

  test("the line says what was chosen and why", () => {
    expect(autoChoiceLine("Diet specialist", "body weight")).toBe(
      "Auto chose Diet specialist: the question is about body weight.",
    );
    expect(autoChoiceLine("General", null)).toBe(
      "Auto chose General: no specialist agent here matched the question.",
    );
  });

  test("a stored answer gets the same line back from its prompt and column", () => {
    expect(
      autoChoiceLineFor("How has my weight changed?", "Auto → Diet specialist"),
    ).toBe("Auto chose Diet specialist: the question is about body weight.");
    expect(autoChoiceLineFor("How did I sleep?", "Auto → General")).toBe(
      "Auto chose General: no specialist agent here matched the question.",
    );
    expect(autoChoiceLineFor("How did I sleep?", "qwen3:8b")).toBeNull();
  });
});
