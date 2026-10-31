import { describe, expect, test } from "bun:test";
import { mulberry32 } from "@/infrastructure/seeded-random";
import {
  attackScore,
  clopperPearson,
  compareMatches,
  evaluateAttack,
  minKMean,
  tprAtFpr,
  type TokenScores,
} from "./metrics";

const target: TokenScores = {
  lp: [-0.1, -2, -0.5, -1],
  digit: [false, true, false, true],
  zlibBytes: 4,
};
const reference: TokenScores = {
  lp: [-0.2, -3, -0.5, -2],
  digit: [false, true, false, true],
  zlibBytes: 4,
};

describe("attackScore", () => {
  test("computes each attack on the trained tokens", () => {
    expect(attackScore("loss", target, reference)).toBeCloseTo(-0.9, 12);
    expect(attackScore("reference", target, reference)).toBeCloseTo(0.525, 12);
    expect(attackScore("minK20", target, reference)).toBeCloseTo(-2, 12);
    expect(attackScore("zlib", target, reference)).toBeCloseTo(-0.9, 12);
    expect(attackScore("referenceDigits", target, reference)).toBeCloseTo(1, 12);
  });

  test("is null without tokens and refuses misaligned scores", () => {
    const empty: TokenScores = { lp: [], digit: [], zlibBytes: 0 };
    expect(attackScore("loss", empty, empty)).toBeNull();
    expect(
      attackScore(
        "referenceDigits",
        { ...target, digit: [false, false, false, false] },
        reference,
      ),
    ).toBeNull();
    expect(() => attackScore("loss", target, empty)).toThrow();
  });
});

describe("minKMean", () => {
  test("averages the lowest share, at least one value", () => {
    expect(minKMean([-1, -5, -2, -4, -3], 0.4)).toBe(-4.5);
    expect(minKMean([-1, -5], 0.1)).toBe(-5);
    expect(minKMean([], 0.2)).toBeNull();
  });
});

describe("clopperPearson", () => {
  test("matches known exact intervals", () => {
    const a = clopperPearson(0, 10);
    expect(a.low).toBe(0);
    expect(a.high).toBeCloseTo(0.3085, 4);
    const b = clopperPearson(5, 10);
    expect(b.low).toBeCloseTo(0.18709, 4);
    expect(b.high).toBeCloseTo(0.81291, 4);
    expect(clopperPearson(10, 10).high).toBe(1);
  });
});

describe("tprAtFpr", () => {
  test("uses the largest threshold within the FPR budget", () => {
    const positives = [10, 9, 8, 0.5];
    const negatives = Array.from({ length: 100 }, (_, i) => i / 100);
    // one negative of 100 may be flagged (0.99); 0.5 would flag about half.
    expect(tprAtFpr(positives, negatives, 0.01)?.k).toBe(3);
    expect(tprAtFpr(positives, negatives, 0.01)?.value).toBe(0.75);
    expect(tprAtFpr([], negatives, 0.01)).toBeNull();
  });
});

describe("evaluateAttack", () => {
  test("perfect separation gives AUROC 1 and TPR 1", () => {
    const rows = [
      ...Array.from({ length: 20 }, (_, i) => ({
        subject: `m${i}`,
        member: true,
        score: 100 + i,
      })),
      ...Array.from({ length: 20 }, (_, i) => ({
        subject: `n${i}`,
        member: false,
        score: i,
      })),
    ];
    const result = evaluateAttack(rows, 200, mulberry32(1));
    expect(result.members).toBe(20);
    expect(result.nonMembers).toBe(20);
    expect(result.auroc.value).toBe(1);
    expect(result.auroc.ci95).toEqual({ low: 1, high: 1 });
    expect(result.tprAt1?.value).toBe(1);
  });

  test("identical scores give AUROC one half", () => {
    const rows = [
      { subject: "a", member: true, score: 1 },
      { subject: "b", member: false, score: 1 },
    ];
    expect(evaluateAttack(rows, 0, mulberry32(1)).auroc.value).toBe(0.5);
  });
});

describe("compareMatches", () => {
  test("rates, difference and a permutation p-value", () => {
    const rows = [
      ...Array.from({ length: 30 }, () => ({ member: true, match: true })),
      ...Array.from({ length: 30 }, () => ({ member: false, match: false })),
    ];
    const result = compareMatches(rows, 999, mulberry32(3));
    expect(result.member?.value).toBe(1);
    expect(result.nonMember?.value).toBe(0);
    expect(result.difference).toBe(1);
    expect(result.permutationP).toBe(0.001);
  });

  test("equal rates give a large p-value", () => {
    const rows = [
      { member: true, match: true },
      { member: true, match: false },
      { member: false, match: true },
      { member: false, match: false },
    ];
    const result = compareMatches(rows, 99, mulberry32(4));
    expect(result.difference).toBe(0);
    expect(result.permutationP).toBe(1);
  });
});
