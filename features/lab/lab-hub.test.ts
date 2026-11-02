import { describe, expect, test } from "bun:test";

import { checksMeta, labHubCards, legacySimulationHref } from "./lab-hub";

const base = {
  checks: ["ok", "ok", "not-ok", "unknown"] as const,
  simulationSubjects: 37,
  runs: { count: 0, more: false, failed: false },
  benchmark: { found: false, runs: 0 },
  jobs: ["done", "none", "none"] as const,
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
      ["2 OK · 1 Not OK · 1 Unknown", "warn"],
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
      simulationSubjects: null,
      runs: { count: 100, more: true, failed: false },
      benchmark: { found: true, runs: 3 },
      jobs: ["working", "done", "working"],
    });
    expect(cards.map((card) => card.meta)).toEqual([
      "2 OK · 1 Not OK · 1 Unknown",
      "Synthetic mode only",
      "Newest 100 runs",
      "Newest of 3 runs",
      "2 jobs running",
      "Question sets hb and v1h",
    ]);
  });

  test("a runs folder that cannot be read, one run, one benchmark run, nobody loaded", () => {
    const cards = labHubCards({
      ...base,
      simulationSubjects: 0,
      runs: { count: 1, more: false, failed: true },
      benchmark: { found: true, runs: 1 },
    });
    expect(cards.slice(1, 4).map((card) => [card.meta, card.tone])).toEqual([
      ["No synthetic people loaded", "off"],
      ["Runs folder could not be read", "warn"],
      ["1 run", "neutral"],
    ]);
  });
});

describe("checksMeta", () => {
  test("all OK is ok; Unknown alone is neutral; none ran is off", () => {
    expect(checksMeta(["ok", "ok"])).toEqual({
      meta: "2 OK · 0 Not OK · 0 Unknown",
      tone: "ok",
    });
    expect(checksMeta(["ok", "unknown"])).toEqual({
      meta: "1 OK · 0 Not OK · 1 Unknown",
      tone: "neutral",
    });
    expect(checksMeta([])).toEqual({ meta: "No checks ran", tone: "off" });
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
