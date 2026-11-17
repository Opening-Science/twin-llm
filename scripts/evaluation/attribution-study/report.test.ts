import { describe, expect, test } from "bun:test";

import { DEV_OPTIONS, generateW1 } from "../../synthetic-wearables/w1-items";

import { studyItems } from "./counterfactual";
import {
  faithfulness,
  numberRates,
  outcomeShare,
  OUTCOMES,
  shareCell,
  studyReport,
} from "./report";
import { fakeModel, runStudy, type StudyRecord, studyCells } from "./run";

const items = generateW1(DEV_OPTIONS);

const records = await runStudy({
  cells: studyCells(studyItems(items, true)),
  models: [fakeModel("first_listed"), fakeModel("cite_other")],
  repeats: 1,
});

const of = (model: string, condition: string): readonly StudyRecord[] =>
  records.filter(
    (record) =>
      record.model === model &&
      record.condition === condition &&
      record.variant === "base",
  );

const attribution = OUTCOMES[0]!;

describe("outcomeShare", () => {
  test("attribution is scored only where a number is expected", () => {
    const share = outcomeShare(of("fake:first_listed", "C1"), attribution);
    const expected = of("fake:first_listed", "C1").filter(
      (record) => record.expected.kind === "state",
    ).length;
    expect(share.n).toBe(expected);
  });

  test("an error counts as a failure", () => {
    const [first] = of("fake:first_listed", "C1").filter(
      (record) => record.expected.kind === "state",
    );
    const failed: StudyRecord = { ...first!, score: null, error: "down", answer: null };
    const share = outcomeShare([failed], attribution);
    expect([share.hits, share.n]).toEqual([0, 1]);
  });

  test("citing another source's reading scores worse than citing the one stated", () => {
    const right = outcomeShare(of("fake:first_listed", "C1"), attribution).share ?? 0;
    const wrong = outcomeShare(of("fake:cite_other", "C1"), attribution).share ?? 1;
    expect(right).toBeGreaterThan(wrong);
  });
});

describe("numberRates", () => {
  test("precision and recall from the number verdicts", () => {
    const rates = numberRates(of("fake:cite_other", "C1"));
    expect(rates.counts.wrong_source).toBeGreaterThan(0);
    expect(rates.precision.n).toBeGreaterThanOrEqual(rates.precision.hits);
  });
});

describe("faithfulness", () => {
  test("taking the first listed source fails the rule swap on some items", () => {
    const faithful = faithfulness(
      records.filter((record) => record.model === "fake:first_listed"),
    );
    expect(faithful.ruleSwapFailure.n).toBeGreaterThan(0);
    expect(faithful.ruleSwapFailure.hits).toBeGreaterThan(0);
    expect(faithful.valueFollows.n).toBeGreaterThan(0);
  });
});

describe("studyReport", () => {
  test("a section per model with every outcome, the verdicts and the reruns", () => {
    const text = studyReport(records, { title: "Dry run", items: "development set" });
    expect(text).toContain("## fake:first_listed");
    expect(text).toContain("## fake:cite_other");
    for (const outcome of OUTCOMES) expect(text).toContain(outcome.label);
    expect(text).toContain("Rule-swap failure (H3)");
    expect(text).toContain("| C0 | C1 | C2 |");
  });

  test("an empty share prints a dash", () => {
    expect(shareCell({ hits: 0, n: 0, share: null, low: null, high: null })).toBe("–");
  });
});
