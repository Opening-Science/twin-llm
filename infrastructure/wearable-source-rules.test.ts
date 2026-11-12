import { describe, expect, test } from "bun:test";

import { judgeByEvidence } from "./open-twin-adapters/aggregate";
import {
  appliedTolerance,
  decideSources,
  decisionLine,
  SOURCE_TOLERANCE,
  sourceRuleLine,
  withinTolerance,
  type EvidenceJudge,
  type SourceDecision,
} from "./wearable-source-rules";

/** Synthetic readings only; no person's data. */
const DAY = "2026-10-15";

const neverCalled: EvidenceJudge = () => {
  throw new Error("the judge is asked only when sources disagree");
};

const only = (decisions: readonly SourceDecision[]): SourceDecision => {
  expect(decisions.length).toBe(1);
  return decisions[0]!;
};

describe("withinTolerance", () => {
  test("the larger of the absolute and the relative bound", () => {
    const hrv = { absolute: 5, relative: 0.1, unit: "ms" };
    expect(withinTolerance([50, 55], hrv)).toBe(true);
    expect(withinTolerance([50, 56], hrv)).toBe(false);
    expect(withinTolerance([90, 99], hrv)).toBe(true);
    expect(withinTolerance([90, 100.5], hrv)).toBe(false);
  });

  const steps = SOURCE_TOLERANCE["step-count"];
  const hrv = SOURCE_TOLERANCE["heart-rate-variability"];

  test("steps: 200 applies at 4,000, 5% (600) at 12,000", () => {
    expect(appliedTolerance(steps, 4000)).toBe(200);
    expect(withinTolerance([3800, 4000], steps)).toBe(true);
    expect(withinTolerance([3799, 4000], steps)).toBe(false);
    expect(appliedTolerance(steps, 3000)).toBe(200);
    expect(withinTolerance([2800, 3000], steps)).toBe(true);
    expect(appliedTolerance(steps, 12000)).toBe(600);
    expect(withinTolerance([11400, 12000], steps)).toBe(true);
    expect(withinTolerance([11399, 12000], steps)).toBe(false);
  });

  test("HRV: 5 ms applies at 40 ms, 10% (8 ms) at 80 ms", () => {
    expect(appliedTolerance(hrv, 40)).toBe(5);
    expect(withinTolerance([35, 40], hrv)).toBe(true);
    expect(withinTolerance([34.9, 40], hrv)).toBe(false);
    expect(appliedTolerance(hrv, 80)).toBe(8);
    expect(withinTolerance([72, 80], hrv)).toBe(true);
    expect(withinTolerance([71.9, 80], hrv)).toBe(false);
  });

  test("the line says which bound applied", () => {
    const agree = (low: number, high: number) =>
      decisionLine(
        only(
          decideSources(
            [
              { key: `activity.steps.${DAY}`, value: high, date: DAY },
              { key: `google.steps.${DAY}`, value: low, unit: "steps", date: DAY },
            ],
            neverCalled,
          ),
        ),
      );
    expect(agree(3800, 4000)).toBe(
      "Google Health agrees (Google Health 3,800 steps): within 200 steps, the larger of 200 steps and 5% of the highest reading. Oura's reading is shown.",
    );
    expect(agree(11400, 12000)).toBe(
      "Google Health agrees (Google Health 11,400 steps): within 600 steps, the larger of 200 steps and 5% of the highest reading. Oura's reading is shown.",
    );
  });
});

describe("decideSources: agreement", () => {
  test("one source has nothing to compare", () => {
    const decision = only(
      decideSources(
        [{ key: `sleep.hrv.long_sleep.${DAY}`, value: 52, unit: "ms", date: DAY }],
        neverCalled,
      ),
    );
    expect(decision.kind).toBe("only_source");
    expect(decisionLine(decision)).toBeNull();
  });

  test("readings within the tolerance agree; the judge is not asked", () => {
    const decision = only(
      decideSources(
        [
          { key: `whoop.recovery.hrv.${DAY}`, value: 54, unit: "ms", date: DAY },
          { key: `sleep.hrv.long_sleep.${DAY}`, value: 52, unit: "ms", date: DAY },
        ],
        neverCalled,
      ),
    );
    expect(decision).toMatchObject({
      kind: "agree",
      measure: "heart-rate-variability",
      day: DAY,
      chosen: { key: `sleep.hrv.long_sleep.${DAY}`, source: "oura", value: 52 },
      others: [{ key: `whoop.recovery.hrv.${DAY}`, source: "whoop", value: 54 }],
    });
    expect(decisionLine(decision)).toBe(
      "WHOOP agrees (WHOOP 54 ms): within 5.4 ms, the larger of 5 ms and 10% of the highest reading. Oura's reading is shown.",
    );
  });

  test("blood oxygen agrees within a percentage point", () => {
    const decision = only(
      decideSources(
        [
          { key: `whoop.recovery.spo2.${DAY}`, value: 96.5, unit: "%", date: DAY },
          {
            key: `google.daily-oxygen-saturation.${DAY}`,
            value: 97,
            unit: "%",
            date: DAY,
          },
        ],
        neverCalled,
      ),
    );
    expect(decisionLine(decision)).toBe(
      "Google Health agrees (Google Health 97.0%): within 1 percentage point. WHOOP's reading is shown.",
    );
  });

  test("a nap is not the night, and related measures are not compared", () => {
    const decisions = decideSources(
      [
        { key: `sleep.hrv.late_nap.${DAY}`, value: 80, unit: "ms", date: DAY },
        { key: `sleep.hr.long_sleep.${DAY}`, value: 50, unit: "bpm", date: DAY },
        { key: `whoop.cycle.avg_hr.${DAY}`, value: 70, unit: "bpm", date: DAY },
        { key: `whoop.recovery.hrv.${DAY}`, value: 54, unit: "ms", date: DAY },
      ],
      neverCalled,
    );
    expect(decisions.map((decision) => decision.kind)).toEqual(["only_source"]);
  });
});

describe("decideSources: disagreement", () => {
  test("published validation picks Oura's HRV over WHOOP's", () => {
    const decision = only(
      decideSources(
        [
          { key: `sleep.hrv.long_sleep.${DAY}`, value: 52, unit: "ms", date: DAY },
          { key: `whoop.recovery.hrv.${DAY}`, value: 61, unit: "ms", date: DAY },
        ],
        judgeByEvidence,
      ),
    );
    expect(decision).toMatchObject({
      kind: "evidence",
      chosen: { source: "oura", value: 52 },
      others: [{ source: "whoop", value: 61 }],
      grades: { oura: "good", whoop: "unknown" },
    });
    expect(decisionLine(decision)).toBe(
      "Sources disagree (WHOOP 61 ms). Oura is used: published validation grades it good for HRV (WHOOP no published grade).",
    );
  });

  test("Google Health's steps over Oura's, on the evidence and not the order", () => {
    const decision = only(
      decideSources(
        [
          { key: `activity.steps.${DAY}`, value: 8000, date: DAY },
          { key: `google.steps.${DAY}`, value: 9500, unit: "steps", date: DAY },
        ],
        judgeByEvidence,
      ),
    );
    expect(decision).toMatchObject({
      kind: "evidence",
      chosen: { source: "google_health", value: 9500 },
      others: [{ source: "oura", value: 8000 }],
    });
  });
});

describe("decideSources: no decision", () => {
  test("no published grade for either source holds the value back", () => {
    const decision = only(
      decideSources(
        [
          { key: `whoop.recovery.rhr.${DAY}`, value: 52, unit: "bpm", date: DAY },
          {
            key: `google.daily-resting-heart-rate.${DAY}`,
            value: 58,
            unit: "bpm",
            date: DAY,
          },
        ],
        judgeByEvidence,
      ),
    );
    expect(decision).toMatchObject({ kind: "held_back", reason: "no_evidence" });
    expect(decisionLine(decision)).toBe(
      "Held back: WHOOP and Google Health disagree on resting heart rate, and no published validation covers these sources for it.",
    );
  });

  test("a tie in the evidence holds the value back", () => {
    const decision = only(
      decideSources(
        [
          { key: `whoop.recovery.spo2.${DAY}`, value: 95, unit: "%", date: DAY },
          {
            key: `google.daily-oxygen-saturation.${DAY}`,
            value: 98,
            unit: "%",
            date: DAY,
          },
        ],
        judgeByEvidence,
      ),
    );
    expect(decision).toMatchObject({ kind: "held_back", reason: "evidence_tie" });
  });

  test("readings in different units are not compared", () => {
    const decision = only(
      decideSources(
        [
          { key: `whoop.recovery.hrv.${DAY}`, value: 0.05, unit: "s", date: DAY },
          { key: `sleep.hrv.long_sleep.${DAY}`, value: 52, unit: "ms", date: DAY },
        ],
        neverCalled,
      ),
    );
    expect(decision).toMatchObject({ kind: "held_back", reason: "units_differ" });
  });

  test("undated readings from two sources cannot be placed on one day", () => {
    const decision = only(
      decideSources(
        [
          { key: "whoop.recovery.hrv.unknown", value: 52, unit: "ms", date: "unknown" },
          { key: "google.daily-heart-rate-variability", value: 60, unit: "ms" },
        ],
        neverCalled,
      ),
    );
    expect(decision).toMatchObject({ kind: "held_back", reason: "no_day", day: null });
  });
});

describe("decideSources: order", () => {
  test("newest day first; the input order does not matter", () => {
    const metrics = [
      { key: "whoop.recovery.hrv.2026-10-14", value: 50, unit: "ms", date: "2026-10-14" },
      { key: `activity.steps.${DAY}`, value: 8000, date: DAY },
      { key: `sleep.hrv.long_sleep.${DAY}`, value: 52, unit: "ms", date: DAY },
    ];
    const forward = decideSources(metrics, neverCalled);
    const backward = decideSources([...metrics].reverse(), neverCalled);
    expect(forward).toEqual(backward);
    expect(forward.map((decision) => [decision.measure, decision.day])).toEqual([
      ["heart-rate-variability", DAY],
      ["step-count", DAY],
      ["heart-rate-variability", "2026-10-14"],
    ]);
  });
});

describe("sourceRuleLine", () => {
  test("a stored note is checked, not trusted", () => {
    expect(sourceRuleLine({ kind: "agree", line: "WHOOP agrees." })).toBe(
      "WHOOP agrees.",
    );
    expect(sourceRuleLine({ kind: "other", line: "x" })).toBeNull();
    expect(sourceRuleLine({ kind: "evidence", line: "" })).toBeNull();
    expect(sourceRuleLine(undefined)).toBeNull();
  });
});
