import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  agentIdOfAutoColumn,
  autoChoiceLine,
  autoChoiceLineFor,
  autoColumnName,
  ROUTE_TOPICS,
  routeAgent,
} from "./agent-router";
import { AGENTS } from "./agents";

const ALL = AGENTS.map(({ id }) => id);

type Fixture = Readonly<{
  items: readonly Readonly<{ prompt: string; expected: string }>[];
}>;

const FIXTURE = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "evaluation", "agent-router.v1.json"), "utf8"),
) as Fixture;

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

  test("no rule matches: the General Practitioner, with no topic", () => {
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

  test("every agent but the General Practitioner has rules, and only real agents do", () => {
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
    const misses = FIXTURE.items.filter(
      ({ prompt, expected }) => routeAgent(prompt, ALL).agentId !== expected,
    );
    expect(1 - misses.length / FIXTURE.items.length).toBeGreaterThanOrEqual(0.9);
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
    expect(autoChoiceLine("General Practitioner", null)).toBe(
      "Auto chose General Practitioner: no specialist agent here matched the question.",
    );
  });

  test("a stored answer gets the same line back from its prompt and column", () => {
    expect(
      autoChoiceLineFor("How has my weight changed?", "Auto → Diet specialist"),
    ).toBe("Auto chose Diet specialist: the question is about body weight.");
    expect(autoChoiceLineFor("How did I sleep?", "Auto → General Practitioner")).toBe(
      "Auto chose General Practitioner: no specialist agent here matched the question.",
    );
    expect(autoChoiceLineFor("How did I sleep?", "qwen3:8b")).toBeNull();
  });
});
