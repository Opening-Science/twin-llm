/**
 * Wearable source attribution and retrieval (#508), on synthetic rows only:
 * Oura and WHOOP disagree on HRV on one day, and the source rules hold back a
 * resting heart rate where WHOOP and Google Health disagree.
 */
import { describe, expect, test } from "bun:test";

import { sha256Hex, toCanonicalJson } from "../../../packages/audit/hash";
import {
  type AuditLine,
  auditedSourceArgs,
  type ResultLine,
  type SourceDecisions,
  verifiedSourceDecisions,
} from "../eval-results";
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
const DAY_BEFORE = "2026-09-30";

const OURA_HRV = { key: `sleep.hrv.${DAY}`, value: 48, unit: "ms" };
const WHOOP_HRV = { key: `whoop.recovery.hrv.${DAY}`, value: 52, unit: "ms" };
const WHOOP_RHR = { key: `whoop.recovery.rhr.${DAY}`, value: 62, unit: "bpm" };
const GOOGLE_RHR = {
  key: `google.daily-resting-heart-rate.${DAY}`,
  value: 55,
  unit: "bpm",
};
/** The day before, Oura alone: the only source, so its reading is the one shown. */
const OURA_HRV_BEFORE = { key: `sleep.hrv.${DAY_BEFORE}`, value: 61, unit: "ms" };

/** WHOOP's HRV is used on published validation; the resting heart rate is held back. */
const DECISIONS: SourceDecisions = {
  rules: "wearable-source-rules/1",
  decisions: [
    {
      measure: "heart-rate-variability",
      day: DAY,
      outcome: "evidence",
      used: "whoop",
      others: ["oura"],
      reason: null,
    },
    {
      measure: "resting-heart-rate",
      day: DAY,
      outcome: "held_back",
      used: null,
      others: ["whoop", "google_health"],
      reason: "no_evidence",
    },
    {
      measure: "heart-rate-variability",
      day: DAY_BEFORE,
      outcome: "only_source",
      used: "oura",
      others: [],
      reason: null,
    },
  ],
};

/** The audit row for `recorded`: its args hash is the one the chain would hold. */
const sourcesRow = (recorded: SourceDecisions): AuditLine => ({
  tool: "wearable.sources.oura+whoop+google_health",
  args_sha256: sha256Hex(toCanonicalJson(auditedSourceArgs(recorded))),
  row_count: recorded.decisions.length,
  refusal: null,
  subject_ref: null,
  source_decisions: recorded,
});

const rows = (...metrics: readonly object[]): readonly WearableRow[] =>
  fetchedRows([{ tool: "wearable_readings", input: {}, output: { rows: metrics } }]);

const ALL_ROWS = rows(OURA_HRV, WHOOP_HRV, WHOOP_RHR, GOOGLE_RHR, OURA_HRV_BEFORE);

const scoreOf = (text: string, decisions: SourceDecisions = DECISIONS) =>
  attributionScore({ text, rows: ALL_ROWS, decisions, verified: true, needed: null });

const labelsOf = (text: string) => scoreOf(text).numbers;

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
    const numbers = labelsOf(`Oura's HRV was 48 ms; WHOOP's HRV was 52 ms on ${DAY}.`);
    expect(numbers.map((n) => [n.stated, n.named, n.label])).toEqual([
      ["48 ms", "oura", "correct"],
      ["52 ms", "whoop", "correct"],
    ]);
  });

  test("no source named: unnamed for the reading the app shows, else misattributed", () => {
    expect(labelsOf(`On ${DAY} your HRV was 52 ms.`)[0]).toMatchObject({
      named: null,
      label: "unnamed",
      key: WHOOP_HRV.key,
    });
    expect(labelsOf(`On ${DAY_BEFORE} your HRV was 61 ms.`)[0]?.label).toBe("unnamed");
    expect(labelsOf(`On ${DAY} your HRV was 48 ms.`)[0]?.label).toBe("misattributed");
  });

  test("a number no reading holds: unsourced", () => {
    expect(labelsOf("Your HRV was 70 ms from Oura.")[0]?.label).toBe("unsourced");
  });

  test("a clause naming another day leaves that day's rows out", () => {
    expect(labelsOf(`On ${DAY_BEFORE} your HRV was 52 ms from WHOOP.`)[0]?.label).toBe(
      "unsourced",
    );
    expect(labelsOf(`On ${DAY} your HRV was 52 ms from WHOOP.`)[0]?.label).toBe(
      "correct",
    );
  });
});

const ANSWERS = [
  "Your HRV was 52 ms from WHOOP.",
  "Your HRV was 48 ms from WHOOP.",
  "Your resting heart rate was 58 bpm.",
  `On ${DAY} your HRV was 52 ms.`,
  `On ${DAY} your HRV was 48 ms.`,
  `On ${DAY_BEFORE} your HRV was 61 ms.`,
] as const;

/** Every order of `items`. */
const orders = <T>(items: readonly T[]): readonly (readonly T[])[] =>
  items.length <= 1
    ? [items]
    : items.flatMap((item, at) =>
        orders([...items.slice(0, at), ...items.slice(at + 1)]).map((rest) => [
          item,
          ...rest,
        ]),
      );

describe("decisions by measure and day", () => {
  test("each decision is found by its measure and day", () => {
    const placed = placeDecisions(DECISIONS.decisions);
    expect(placed.get(`heart-rate-variability|${DAY}`)).toEqual({
      outcome: "evidence",
      used: "whoop",
    });
    expect(placed.get(`heart-rate-variability|${DAY_BEFORE}`)?.outcome).toBe(
      "only_source",
    );
    expect(placed.get(`resting-heart-rate|${DAY}`)?.outcome).toBe("held_back");
  });

  test("shuffled decisions score every answer the same", () => {
    const shuffles = orders(DECISIONS.decisions);
    expect(shuffles).toHaveLength(6);
    for (const answer of ANSWERS) {
      const expected = scoreOf(answer);
      for (const decisions of shuffles) {
        const shuffled: SourceDecisions = { ...DECISIONS, decisions: [...decisions] };
        // Each order hashes to its own audit row, so each one verifies.
        expect(verifiedSourceDecisions(sourcesRow(shuffled))).toEqual(shuffled);
        expect(scoreOf(answer, shuffled)).toEqual(expected);
      }
    }
  });

  test("two different decisions for one measure and day: neither is used", () => {
    const [first] = DECISIONS.decisions;
    if (first === undefined) throw new Error("fixture has decisions");
    const placed = placeDecisions([first, { ...first, outcome: "agree" }]);
    expect(placed.has(`heart-rate-variability|${DAY}`)).toBe(false);
  });

  test("decisions that do not hash to their audit row are not used", () => {
    const row = { ...sourcesRow(DECISIONS), args_sha256: "c".repeat(64) };
    expect(verifiedSourceDecisions(row)).toBeNull();
    const score = attributionScore({
      text: "Your resting heart rate was 58 bpm.",
      rows: ALL_ROWS,
      decisions: DECISIONS,
      verified: false,
      needed: null,
    });
    expect(score.verified).toBe(false);
    expect(score.numbers[0]?.label).toBe("unsourced");
  });

  test("the hash leaves the days out, as the audit row does", () => {
    expect(auditedSourceArgs(DECISIONS).decisions[0]).toEqual({
      measure: "heart-rate-variability",
      outcome: "evidence",
      used: "whoop",
      others: ["oura"],
      reason: null,
    });
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

const wearableLine = (answer: string, audit: AuditLine = sourcesRow(DECISIONS)) =>
  line({
    answer,
    audit: [audit],
    tool_results: [
      {
        tool: "wearable_readings",
        input: {},
        output: { rows: [OURA_HRV, WHOOP_HRV, WHOOP_RHR] },
      },
    ],
  }) satisfies ResultLine;

describe("scoreAttribution on a results line", () => {
  test("reads rows, verified decisions and the item's needed rows", () => {
    const item = wearableItem([OURA_HRV.key, WHOOP_HRV.key, GOOGLE_RHR.key]);
    const answered = wearableLine("Your HRV was 52 ms from WHOOP.");
    if (!isAnswered(answered)) throw new Error("fixture is answered");
    const score = scoreAttribution({ item, line: answered });
    expect(score?.rules).toBe("wearable-source-rules/1");
    expect(score?.verified).toBe(true);
    expect(score?.counts).toEqual({
      correct: 1,
      unnamed: 0,
      misattributed: 0,
      stated_withheld: 0,
      unsourced: 0,
    });
    expect(score?.retrieval?.recall).toBe(2 / 3);
  });

  test("a line whose decisions do not hash to the audit row is not verified", () => {
    const answered = wearableLine("Your resting heart rate was 58 bpm.", {
      ...sourcesRow(DECISIONS),
      args_sha256: "c".repeat(64),
    });
    if (!isAnswered(answered)) throw new Error("fixture is answered");
    const score = scoreAttribution({ item: wearableItem(), line: answered });
    expect(score?.verified).toBe(false);
    expect(score?.counts.stated_withheld).toBe(0);
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
