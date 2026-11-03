import { describe, expect, test } from "bun:test";

import { checksMeta, LAB_PARTS, labHubCards, legacySimulationHref } from "./lab-hub";

const base = {
  checkCount: 9,
  simulationSubjects: 37,
  runs: { count: 0, failed: false },
  benchmarkRuns: 0,
  jobs: ["done", "none"] as const,
};

describe("labHubCards", () => {
  test("one card per part, in hub order, each with its own page", () => {
    expect(labHubCards(base).map((card) => [card.href, card.title])).toEqual([
      ["/lab/checks", "Verifiability"],
      ["/lab/simulations", "Heart rhythm simulations"],
      ["/lab/evaluations", "Evaluation runs"],
      ["/lab/benchmark", "Rhythm benchmark"],
      ["/lab/jobs", "Long jobs"],
      ["/lab/rate", "Second rating"],
    ]);
  });

  test("meta lines on a fresh synthetic machine", () => {
    expect(labHubCards(base).map((card) => [card.meta, card.tone])).toEqual([
      ["9 checks", "neutral"],
      ["37 synthetic people", "neutral"],
      ["Not run yet", "off"],
      ["Not run yet", "off"],
      ["Nothing running", "neutral"],
      ["Question sets hb and v1h", "neutral"],
    ]);
  });

  test("meta lines once things have run", () => {
    const cards = labHubCards({
      ...base,
      simulationSubjects: "personal",
      runs: { count: 100, failed: false },
      benchmarkRuns: 3,
      jobs: ["working", "working"],
    });
    expect(cards.map((card) => card.meta)).toEqual([
      "9 checks",
      "Synthetic mode only",
      "100 runs",
      "3 runs",
      "2 jobs running",
      "Question sets hb and v1h",
    ]);
  });

  test("a runs folder that cannot be read, one benchmark run, nobody loaded", () => {
    const cards = labHubCards({
      ...base,
      simulationSubjects: 0,
      runs: { count: 1, failed: true },
      benchmarkRuns: 1,
    });
    expect(cards.slice(1, 4).map((card) => [card.meta, card.tone])).toEqual([
      ["No synthetic people loaded", "off"],
      ["Runs folder could not be read", "warn"],
      ["1 run", "neutral"],
    ]);
  });

  test("a database that did not answer is said, not counted as nobody", () => {
    expect(labHubCards({ ...base, simulationSubjects: "unread" })[1]).toMatchObject({
      meta: "Synthetic people could not be counted",
      tone: "warn",
    });
  });

  test("the hub order: what runs here, what you can make, what was measured, who rates", () => {
    expect(LAB_PARTS).toEqual([
      "checks",
      "simulations",
      "evaluations",
      "benchmark",
      "jobs",
      "rate",
    ]);
  });
});

describe("checksMeta", () => {
  test("counts the checks without a status: none has run on the hub", () => {
    expect(checksMeta(9)).toEqual({ meta: "9 checks", tone: "neutral" });
    expect(checksMeta(1)).toEqual({ meta: "1 check", tone: "neutral" });
  });
});

describe("legacySimulationHref", () => {
  test("an old recording link goes to the simulations page with its fields", () => {
    expect(
      legacySimulationHref({
        subject: "abc",
        date: "2025-01-02",
        seconds: "300",
        recording: "7",
      }),
    ).toBe("/lab/simulations?subject=abc&date=2025-01-02&seconds=300&recording=7");
  });

  test("no recording fields: stay on the hub", () => {
    expect(legacySimulationHref({})).toBeNull();
    expect(legacySimulationHref({ other: "x", subject: ["a", "b"] })).toBeNull();
  });
});
