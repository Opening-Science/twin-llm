/**
 * Wearable source attribution and retrieval (#508), on synthetic rows only:
 * Oura and WHOOP disagree on HRV on one day, and the source rules hold back a
 * resting heart rate where WHOOP and Google Health disagree.
 */
import { describe, expect, test } from "bun:test";

import type { AuditLine, ResultLine, SourceDecisions } from "../eval-results";
import { questionSchema, type Question } from "../question-set";

import {
  attributionScore,
  fetchedRows,
  placeDecisions,
  retrievalOf,
  scoreAttribution,
  type WearableRow,
} from "./attribution";
import { line, trendItem } from "./fixtures";
import { scoreRun } from "./score-run";
import { isAnswered } from "./types";

const DAY = "2026-10-01";

const OURA_HRV = { key: `sleep.hrv.${DAY}`, value: 48, unit: "ms" };
const WHOOP_HRV = { key: `whoop.recovery.hrv.${DAY}`, value: 52, unit: "ms" };
const WHOOP_RHR = { key: `whoop.recovery.rhr.${DAY}`, value: 62, unit: "bpm" };
const GOOGLE_RHR = {
  key: `google.daily-resting-heart-rate.${DAY}`,
  value: 55,
  unit: "bpm",
};

/** WHOOP's HRV is used on published validation; the resting heart rate is held back. */
const DECISIONS: SourceDecisions = {
  rules: "wearable-source-rules/1",
  decisions: [
    {
      measure: "heart-rate-variability",
      outcome: "evidence",
      used: "whoop",
      others: ["oura"],
      reason: null,
    },
    {
      measure: "resting-heart-rate",
      outcome: "held_back",
      used: null,
      others: ["whoop", "google_health"],
      reason: "no_evidence",
    },
  ],
};

const SOURCES_ROW: AuditLine = {
  tool: "wearable.sources.oura+whoop+google_health",
  args_sha256: "b".repeat(64),
  row_count: 2,
  refusal: null,
  subject_ref: null,
  source_decisions: DECISIONS,
};

const rows = (...metrics: readonly object[]): readonly WearableRow[] =>
  fetchedRows([{ tool: "wearable_readings", input: {}, output: { rows: metrics } }]);

const ALL_ROWS = rows(OURA_HRV, WHOOP_HRV, WHOOP_RHR, GOOGLE_RHR);

const labelsOf = (text: string) =>
  attributionScore({ text, rows: ALL_ROWS, decisions: DECISIONS, needed: null }).numbers;

describe("attribution labels", () => {
  test("52 ms from WHOOP is the WHOOP reading: correct", () => {
    expect(labelsOf("Your HRV was 52 ms from WHOOP.")).toEqual([
      {
        stated: "52 ms",
        measure: "heart-rate-variability",
        named: "whoop",
        label: "correct",
        key: WHOOP_HRV.key,
      },
    ]);
  });

  test("48 ms from WHOOP is Oura's value under WHOOP: misattributed", () => {
    expect(labelsOf("Your HRV was 48 ms from WHOOP.")).toEqual([
      {
        stated: "48 ms",
        measure: "heart-rate-variability",
        named: "whoop",
        label: "misattributed",
        key: OURA_HRV.key,
      },
    ]);
  });

  test("a held-back measure stated as a number: stated_withheld", () => {
    const [stated] = labelsOf("Your resting heart rate was 58 bpm.");
    expect(stated?.label).toBe("stated_withheld");
    const [reading] = labelsOf("WHOOP's resting heart rate was 62 bpm.");
    expect(reading).toMatchObject({ label: "stated_withheld", key: WHOOP_RHR.key });
  });

  test("a source named before the number, and one per clause", () => {
    const numbers = labelsOf("Oura's HRV was 48 ms; WHOOP's HRV was 52 ms.");
    expect(numbers.map((n) => [n.stated, n.named, n.label])).toEqual([
      ["48 ms", "oura", "correct"],
      ["52 ms", "whoop", "correct"],
    ]);
  });

  test("no source named: correct only for the reading the rules used", () => {
    expect(labelsOf("Your HRV was 52 ms.")[0]?.label).toBe("correct");
    expect(labelsOf("Your HRV was 48 ms.")[0]?.label).toBe("misattributed");
  });

  test("a number no reading holds: unsourced", () => {
    expect(labelsOf("Your HRV was 70 ms from Oura.")[0]?.label).toBe("unsourced");
  });

  test("a clause naming another day leaves that day's rows out", () => {
    expect(labelsOf("On 2026-09-30 your HRV was 52 ms from WHOOP.")[0]?.label).toBe(
      "unsourced",
    );
    expect(labelsOf(`On ${DAY} your HRV was 52 ms from WHOOP.`)[0]?.label).toBe(
      "correct",
    );
  });
});

describe("decisions placed on the rows", () => {
  test("each decision meets its measure and day", () => {
    const { placed, aligned } = placeDecisions(ALL_ROWS, DECISIONS.decisions);
    expect(aligned).toBe(true);
    expect(placed.get(`heart-rate-variability|${DAY}`)).toEqual({
      outcome: "evidence",
      used: "whoop",
    });
    expect(placed.get(`resting-heart-rate|${DAY}`)?.outcome).toBe("held_back");
  });

  test("decisions for other sources do not line up, and are not used", () => {
    const { placed, aligned } = placeDecisions(
      rows(OURA_HRV, WHOOP_HRV),
      DECISIONS.decisions.slice(1),
    );
    expect(aligned).toBe(false);
    expect(placed.size).toBe(0);
  });
});

describe("retrieval", () => {
  test("two of three needed rows fetched: recall exactly 2/3", () => {
    const retrieval = retrievalOf(
      [OURA_HRV.key, WHOOP_HRV.key, "activity.steps.2026-10-01"],
      [OURA_HRV.key, WHOOP_HRV.key, WHOOP_RHR.key],
    );
    expect(retrieval).toEqual({
      needed: 3,
      fetched: 3,
      hits: 2,
      recall: 2 / 3,
      precision: 2 / 3,
    });
  });

  test("nothing needed or fetched: no rate", () => {
    expect(retrievalOf([], [])).toMatchObject({ recall: null, precision: null });
  });
});

const wearableItem = (wearableRows?: readonly string[]): Question => {
  const base = trendItem();
  return questionSchema.parse({
    ...base,
    expect: {
      ...base.expect,
      ...(wearableRows === undefined ? {} : { wearable_rows: wearableRows }),
    },
  });
};

const wearableLine = (answer: string): ResultLine =>
  line({
    answer,
    audit: [SOURCES_ROW],
    tool_results: [
      {
        tool: "wearable_readings",
        input: {},
        output: { rows: [OURA_HRV, WHOOP_HRV, WHOOP_RHR] },
      },
    ],
  });

describe("scoreAttribution on a results line", () => {
  test("reads rows, decisions and the item's needed rows", () => {
    const item = wearableItem([OURA_HRV.key, WHOOP_HRV.key, GOOGLE_RHR.key]);
    const answered = wearableLine("Your HRV was 52 ms from WHOOP.");
    if (!isAnswered(answered)) throw new Error("fixture is answered");
    const score = scoreAttribution({ item, line: answered });
    expect(score?.rules).toBe("wearable-source-rules/1");
    expect(score?.counts).toEqual({
      correct: 1,
      misattributed: 0,
      stated_withheld: 0,
      unsourced: 0,
    });
    expect(score?.retrieval?.recall).toBe(2 / 3);
    // Google Health's resting heart rate was not fetched: that decision does not line up.
    expect(score?.aligned).toBe(false);
  });

  test("a line with no wearable rows and none needed is not scored", () => {
    const answered = line();
    if (!isAnswered(answered)) throw new Error("fixture is answered");
    expect(scoreAttribution({ item: trendItem(), line: answered })).toBeNull();
  });

  test("scoreRun carries it on each scored line", () => {
    const item = wearableItem([OURA_HRV.key]);
    const [scores] = scoreRun({
      models: [{ provider: "ollama", modelId: "qwen3:4b" }],
      items: [item],
      entries: {},
      lines: [wearableLine("Your HRV was 48 ms from WHOOP.")],
    });
    expect(scores?.scored[0]?.attribution?.counts.misattributed).toBe(1);
  });
});
