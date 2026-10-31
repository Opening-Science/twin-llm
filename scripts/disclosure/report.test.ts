import { describe, expect, test } from "bun:test";
import {
  analyseModel,
  analyseProbes,
  attackTable,
  pearson,
  probeTable,
  tokenScores,
  type ItemRow,
  type ScoreRow,
} from "./report";

const score = (id: string, lp: number[]): ScoreRow => ({
  id,
  n: lp.length,
  lp,
  digit: lp.map((_, i) => (i === 0 ? 1 : 0)),
  zlib: 10,
});

describe("tokenScores", () => {
  test("turns digit flags into booleans", () => {
    expect(tokenScores(score("a", [-1, -2]))).toEqual({
      lp: [-1, -2],
      digit: [true, false],
      zlibBytes: 10,
    });
  });
});

describe("analyseModel", () => {
  const items: ItemRow[] = [
    { id: "m1", level: "record", member: true, subject: "a" },
    { id: "n1", level: "record", member: false, subject: "b" },
    { id: "m2", level: "subject", member: true, subject: "a" },
    { id: "n2", level: "subject", member: false, subject: "b" },
  ];
  const target = new Map([
    ["m1", score("m1", [-0.1, -0.1])],
    ["n1", score("n1", [-1, -1])],
    ["m2", score("m2", [-1, -1])],
  ]);
  const reference = new Map([
    ["m1", score("m1", [-1, -1])],
    ["n1", score("n1", [-1, -1])],
    ["m2", score("m2", [-1, -1])],
  ]);

  test("separates the record level and counts missing scores", () => {
    const result = analyseModel(items, target, reference, 50, 1);
    expect(result.record.reference.auroc.value).toBe(1);
    expect(result.record.loss.members).toBe(1);
    expect(result.record.loss.missing).toBe(0);
    expect(result.subject.loss.missing).toBe(1);
    expect(result.subject.loss.auroc.value).toBeNull();
  });

  test("renders a table row per attack and level", () => {
    const table = attackTable(analyseModel(items, target, reference, 0, 1));
    expect(table.split("\n").length).toBe(12);
    expect(table).toContain(
      "| Reference (target minus reference) | record | 1 / 1 | 1.000 (n/a to n/a) | 100.0% (2.5% to 100.0%) |",
    );
  });
});

describe("analyseProbes", () => {
  test("matches answers against the true numbers", () => {
    const probes = [
      { id: "p1", member: true, numbers: [410] },
      { id: "p2", member: false, numbers: [380] },
      { id: "p3", member: false, numbers: [7] },
    ];
    const answers = new Map([
      ["p1", "It was 410 min."],
      ["p2", "I cannot see that without a tool."],
    ]);
    const result = analyseProbes(probes, answers, 9, 1);
    expect(result.member?.k).toBe(1);
    expect(result.nonMember?.k).toBe(0);
    expect(result.nonMember?.n).toBe(1);
    expect(result.unanswered).toBe(1);
    expect(probeTable([["m", result]])).toContain("| m | 1/1 100.0%");
  });
});

describe("pearson", () => {
  test("is 1 for a linear relation and null without spread", () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 12);
    expect(pearson([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1, 12);
    expect(pearson([1, 1], [1, 2])).toBeNull();
    expect(pearson([1], [1])).toBeNull();
  });
});
