import { describe, expect, test } from "bun:test";

import { DEV_OPTIONS, generateW1 } from "../../synthetic-wearables/w1-items";

import {
  clusterBootstrap,
  contrastsMarkdown,
  detection,
  holm,
  incompleteBeta,
  partA,
  probit,
  riskDifference,
  ruleSwapFailure,
  tTwoSidedP,
  welch,
} from "./analysis";
import { studyItems } from "./counterfactual";
import { fakeModel, runStudy, type StudyRecord, studyCells } from "./run";

const QUICK = { resamples: 400, seed: 1 };

describe("probit and the incomplete beta", () => {
  test("known quantiles", () => {
    expect(probit(0.5)).toBeCloseTo(0, 8);
    expect(probit(0.975)).toBeCloseTo(1.959964, 5);
    expect(probit(0.01)).toBeCloseTo(-2.326348, 5);
    expect(() => probit(1)).toThrow();
  });

  test("I_x(1, 1) is x; symmetric for a = b", () => {
    expect(incompleteBeta(0.3, 1, 1)).toBeCloseTo(0.3, 10);
    expect(incompleteBeta(0.5, 4, 4)).toBeCloseTo(0.5, 10);
  });
});

describe("detection", () => {
  test("the log-linear correction keeps perfect scores finite", () => {
    const perfect = detection({ hits: 8, signal: 8, falseAlarms: 0, noise: 8 });
    expect(perfect.dPrime).toBeCloseTo(probit(8.5 / 9) - probit(0.5 / 9), 10);
    expect(perfect.criterion).toBeCloseTo(0, 10);
  });

  test("chance gives d′ 0; flagging everything a liberal criterion", () => {
    expect(
      detection({ hits: 4, signal: 8, falseAlarms: 4, noise: 8 }).dPrime,
    ).toBeCloseTo(0, 10);
    expect(
      detection({ hits: 8, signal: 8, falseAlarms: 8, noise: 8 }).criterion,
    ).toBeLessThan(0);
  });
});

describe("welch", () => {
  test("t-distribution p-values at table values", () => {
    // Two-sided 5% critical values: 2.228 at 10 df, 2.042 at 30, 1.960 for large df.
    expect(tTwoSidedP(2.228, 10)).toBeCloseTo(0.05, 3);
    expect(tTwoSidedP(2.042, 30)).toBeCloseTo(0.05, 3);
    expect(tTwoSidedP(1.96, 1e6)).toBeCloseTo(0.05, 3);
    expect(tTwoSidedP(0, 10)).toBeCloseTo(1, 10);
  });

  test("equal variances and sizes give the pooled t and n1 + n2 − 2 df", () => {
    const a = [1, 2, 3, 4, 5];
    const b = [3, 4, 5, 6, 7];
    const result = welch(a, b);
    // Means 3 and 5, variances 2.5 each: t = 2 / sqrt(2.5/5 + 2.5/5) = 2.
    expect(result.difference).toBe(2);
    expect(result.t).toBeCloseTo(2, 10);
    expect(result.df).toBeCloseTo(8, 10);
    expect(result.p).toBeCloseTo(tTwoSidedP(2, 8), 10);
  });

  test("equal groups give p near 1", () => {
    expect(welch([1, 2, 3, 4], [1, 2, 3, 4]).p).toBeCloseTo(1, 6);
  });
});

describe("holm", () => {
  test("step-down: stops at the first test it cannot reject", () => {
    expect(holm({ H1: 0.01, H2a: 0.04, H3: 0.03 })).toEqual({
      H1: { adjusted: 0.03, reject: true },
      H3: { adjusted: 0.06, reject: false },
      H2a: { adjusted: 0.06, reject: false },
    });
  });

  test("a null p-value is left out of the family", () => {
    expect(Object.keys(holm({ H1: 0.01, H3: null }))).toEqual(["H1"]);
  });
});

describe("clusterBootstrap", () => {
  test("seeded: the same seed gives the same draws", () => {
    const clusters = [[1], [2, 3], [4], [5, 6, 7]];
    const mean = (sample: readonly number[]) =>
      sample.reduce((sum, value) => sum + value, 0) / sample.length;
    expect(clusterBootstrap(clusters, mean, 50, 3)).toEqual(
      clusterBootstrap(clusters, mean, 50, 3),
    );
    expect(clusterBootstrap(clusters, mean, 50, 3)).toHaveLength(50);
  });
});

const items = generateW1(DEV_OPTIONS);
const records = await runStudy({
  cells: studyCells(studyItems(items, true)),
  models: [fakeModel("first_listed")],
  repeats: 1,
});

/** C0 records' scores marked wrong, to give H1 a known effect. */
const withWorseC0 = (input: readonly StudyRecord[]): readonly StudyRecord[] =>
  input.map((record) =>
    record.condition === "C0" && record.score !== null
      ? { ...record, score: { ...record.score, attributionCorrect: false } }
      : record,
  );

describe("partA", () => {
  test("no difference between conditions gives a zero risk difference and p 1", () => {
    const h1 = riskDifference(
      records.filter((record) => record.variant === "base"),
      "attributionCorrect",
      "C0",
      "C1",
      QUICK,
    );
    expect(h1.estimate).toBe(0);
    expect(h1.p).toBe(1);
    expect(h1.clusters).toBe(20);
  });

  test("a known effect is found, with an interval that excludes zero", () => {
    const result = partA(withWorseC0(records), QUICK);
    expect(result.h1.estimate).toBe(1);
    expect(result.h1.low).toBe(1);
    expect(result.holm.H1?.reject).toBe(true);
  });

  test("H3: taking the first listed source fails the rule swap well above 5%", () => {
    const h3 = ruleSwapFailure(records, QUICK);
    expect(h3.estimate).toBeGreaterThan(0.3);
    expect(h3.low).toBeGreaterThan(0.05);
    expect(h3.p).toBe(0);
  });

  test("H2b reports non-inferiority from the upper bound", () => {
    const result = partA(records, QUICK);
    expect(result.h2b.estimate).toBe(0);
    expect(result.h2b.nonInferior).toBe(true);
  });

  test("H2b is evaluated only when H2a is supported", () => {
    expect(partA(records, QUICK).h2b.evaluated).toBe(false);
    const betterC2 = records.map((record) =>
      record.stratum === "disagree" && record.score !== null
        ? {
            ...record,
            score: { ...record.score, disagreementHandled: record.condition === "C2" },
          }
        : record,
    );
    const result = partA(betterC2, QUICK);
    expect(result.supported.H2a).toBe(true);
    expect(result.h2b.evaluated).toBe(true);
  });

  test("an error on an agree item counts as over-hedged", () => {
    const failedC2 = records.map((record) =>
      record.variant === "base" && record.stratum === "agree" && record.condition === "C2"
        ? { ...record, score: null, error: "down", answer: null }
        : record,
    );
    expect(partA(failedC2, QUICK).h2b.estimate).toBe(1);
  });
});

describe("contrastsMarkdown", () => {
  test("H2b says it was not evaluated when H2a is not supported", () => {
    const row =
      contrastsMarkdown(partA(records, QUICK)).find((line) => line.startsWith("| H2b:")) ??
      "";
    expect(row).toContain("not evaluated: H2a not supported");
  });

  const h1Row = (lines: readonly string[]) =>
    lines.find((line) => line.startsWith("| H1:")) ?? "";

  test("a significant effect in the predicted direction is supported", () => {
    expect(h1Row(contrastsMarkdown(partA(withWorseC0(records), QUICK)))).toContain(
      "(supported)",
    );
  });

  test("a significant effect the other way is not", () => {
    const worseC1 = records.map((record) =>
      record.condition === "C1" && record.score !== null
        ? { ...record, score: { ...record.score, attributionCorrect: false } }
        : record,
    );
    const row = h1Row(contrastsMarkdown(partA(worseC1, QUICK)));
    expect(row).toContain("-100.0");
    expect(row).toContain("(not supported)");
  });
});
