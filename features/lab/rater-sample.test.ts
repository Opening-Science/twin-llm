import { describe, expect, test } from "bun:test";

import { createHash } from "node:crypto";

import { blindLines, raterLines, type RunLines } from "./rater-lines";
import {
  linesInScope,
  PER_SCENARIO_CAP,
  raterScopeOf,
  reviewSample,
  sampleRank,
} from "./rater-sample";

/** A v1h-shaped set: items per scenario as in questions.v1h.v1.json, plus one S7 item. */
const SHAPE: Readonly<Record<string, number>> = {
  S1: 9,
  S2: 8,
  S3: 3,
  S4: 3,
  S5: 4,
  S6: 5,
  S7: 1,
};

const ITEMS = Object.entries(SHAPE).flatMap(([scenario, count]) =>
  Array.from({ length: count }, (_, at) => ({
    id: `Q-${scenario}-H${String(at + 1).padStart(2, "0")}`,
    question: `Question ${scenario} ${at + 1}?`,
    scenario,
    human: "Note.",
  })),
);

/** Two repeats of every S1 item, one of everything else, so S1 has more lines than items. */
const runOf = (runId: string): RunLines => ({
  runId,
  lines: ITEMS.flatMap((item) =>
    (item.scenario === "S1" ? [1, 2] : [1]).map((repeat) => ({
      item_id: item.id,
      repeat,
      error: null,
      text: `Reply ${repeat} to ${item.question}`,
    })),
  ),
});

const RUNS = [runOf("2026-11-02-v1h-model-a"), runOf("2026-11-02-v1h-model-b")];
const SALT = "a".repeat(64);
const OTHER_SALT = "b".repeat(64);
const LINES = raterLines(RUNS, ITEMS, {}, SALT);

const ids = (lines: readonly { runId: string; itemId: string; repeat: number }[]) =>
  lines.map((line) => `${line.runId} ${line.itemId} ${line.repeat}`).sort();

const countBy = (
  lines: readonly { runId: string; scenario: string }[],
  runId: string,
  scenario: string,
) => lines.filter((line) => line.runId === runId && line.scenario === scenario).length;

describe("sampleRank", () => {
  test("is sha256 of the protocol label, run, item and repeat", () => {
    expect(sampleRank("run-a", "Q-S1-H01", 2)).toBe(
      createHash("sha256").update("v1h-review.v1\nrun-a\nQ-S1-H01\n2").digest("hex"),
    );
  });
});

describe("reviewSample", () => {
  const sample = reviewSample(LINES);

  test("every S5 and S6 line, up to four per scenario of S1 to S4, per run, no S7", () => {
    for (const run of RUNS) {
      expect(countBy(sample, run.runId, "S1")).toBe(PER_SCENARIO_CAP);
      expect(countBy(sample, run.runId, "S2")).toBe(PER_SCENARIO_CAP);
      expect(countBy(sample, run.runId, "S3")).toBe(3);
      expect(countBy(sample, run.runId, "S4")).toBe(3);
      expect(countBy(sample, run.runId, "S5")).toBe(4);
      expect(countBy(sample, run.runId, "S6")).toBe(5);
      expect(countBy(sample, run.runId, "S7")).toBe(0);
    }
    expect(sample).toHaveLength(2 * 23);
  });

  test("picks the lowest ranks in a capped scenario", () => {
    for (const run of RUNS) {
      const of = LINES.filter(
        (line) => line.runId === run.runId && line.scenario === "S1",
      );
      const rank = (line: (typeof LINES)[number]) =>
        sampleRank(line.runId, line.itemId, line.repeat);
      const highestChosen = sample
        .filter((line) => line.runId === run.runId && line.scenario === "S1")
        .map(rank)
        .sort()
        .at(-1);
      const left = of.filter((line) => !sample.includes(line)).map(rank);
      expect(
        left.every((each) => highestChosen !== undefined && each > highestChosen),
      ).toBe(true);
    }
  });

  test("is reproducible and does not depend on the input order", () => {
    expect(ids(reviewSample(LINES))).toEqual(ids(sample));
    expect(ids(reviewSample([...LINES].reverse()))).toEqual(ids(sample));
  });

  test("is drawn per run: two runs of the same items get different S1 lines", () => {
    const picked = (runId: string) =>
      sample
        .filter((line) => line.runId === runId && line.scenario === "S1")
        .map((line) => `${line.itemId} ${line.repeat}`)
        .sort();
    expect(picked(RUNS[0]?.runId ?? "")).not.toEqual(picked(RUNS[1]?.runId ?? ""));
  });

  test("is the same lines under every salt, so two raters rate the same lines", () => {
    const other = raterLines(RUNS, ITEMS, {}, OTHER_SALT);
    expect(ids(reviewSample(other))).toEqual(ids(sample));
  });
});

describe("the order a rater sees the sample in", () => {
  const sample = reviewSample(LINES);
  const order = (salt: string) =>
    blindLines(
      reviewSample(raterLines(RUNS, ITEMS, {}, salt)),
      "seed",
      salt,
      new Map(),
    ).map((line) => line.question);

  test("is reproducible for one salt and differs for another", () => {
    expect(order(SALT)).toEqual(order(SALT));
    expect(order(OTHER_SALT)).not.toEqual(order(SALT));
  });

  test("is shuffled across scenarios and runs, not grouped by stratum", () => {
    const shown = blindLines(sample, "seed", SALT, new Map());
    const scenarioOf = new Map(sample.map((line) => [line.token, line.scenario]));
    const runOfToken = new Map(sample.map((line) => [line.token, line.runId]));
    const runs = shown.map((line) => runOfToken.get(line.token));
    const scenarios = shown.map((line) => scenarioOf.get(line.token));
    expect(scenarios).not.toEqual([...scenarios].sort());
    expect(runs).not.toEqual([...runs].sort());
  });

  test("the page payload carries no run, item, scenario or score", () => {
    const shown = blindLines(sample, "seed", SALT, new Map());
    for (const line of shown) {
      expect(Object.keys(line).sort()).toEqual([
        "answer",
        "comment",
        "level",
        "note",
        "question",
        "reference",
        "referenceKind",
        "token",
      ]);
    }
    const payload = JSON.stringify(shown);
    for (const leak of [
      "2026-11-02-v1h-model",
      "Q-S1-H",
      '"S1"',
      "scenario",
      "pass",
      "fail",
      "correctness",
      SALT,
    ]) {
      expect(payload).not.toContain(leak);
    }
  });
});

describe("linesInScope and raterScopeOf", () => {
  test("v1h shows the sample by default and every line with all; hb every line", () => {
    expect(linesInScope("v1h", LINES, "sample")).toHaveLength(46);
    expect(linesInScope("v1h", LINES, "all")).toHaveLength(LINES.length);
    expect(linesInScope("hb", LINES, "sample")).toHaveLength(LINES.length);
  });

  test("only 1, true or all ask for every line", () => {
    expect(raterScopeOf("1")).toBe("all");
    expect(raterScopeOf("true")).toBe("all");
    expect(raterScopeOf("all")).toBe("all");
    expect(raterScopeOf(undefined)).toBe("sample");
    expect(raterScopeOf("0")).toBe("sample");
    expect(raterScopeOf(["1"])).toBe("sample");
  });
});
