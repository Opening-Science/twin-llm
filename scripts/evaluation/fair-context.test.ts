import { describe, expect, test } from "bun:test";

import { BLOCK_END, BLOCK_START } from "./context-arm";
import {
  buildFairBlock,
  codeSummaries,
  codeText,
  conditionsText,
  FAIR_RECENT_ROWS,
  type FairRead,
  firstSubject,
  medicationsText,
  NO_SUBJECT_TEXT,
  RECORD_TOOL,
  type RecordObservation,
  type SubjectRecord,
  subjectFromQuestion,
} from "./fair-context";

/** Synthetic rows only; the subject ref, codes and values are made up. */
const SUBJECT = "00000000-0000-4000-8000-00000000000a";

const reading = (
  loinc: string,
  value: number,
  at: string,
  unit = "mg/dL",
  display = `Code ${loinc}`,
): RecordObservation => ({ loinc, display, unit, value, at: `${at}T08:00:00.000Z` });

const RECORD: SubjectRecord = {
  subjectRef: SUBJECT,
  observations: [
    reading("2093-3", 190, "2020-01-01"),
    reading("2093-3", 185, "2023-01-01"),
    reading("4548-4", 5.9, "2024-01-01", "%"),
    reading("4548-4", 6.1, "2025-01-01", "%"),
    reading("29463-7", 80, "2022-06-01", "kg"),
  ],
  conditions: [
    {
      code: "44054006",
      display: "Diabetes mellitus type 2",
      onset: "2019-05-01T00:00:00.000Z",
      abatement: null,
      status: "active",
    },
  ],
  medications: [
    {
      code: "860975",
      display: "metformin 500 MG Oral Tablet",
      authored: "2019-05-02T00:00:00.000Z",
      status: "active",
      dosage: null,
    },
  ],
};

const record = (fields: Partial<SubjectRecord> = {}): FairRead => ({
  kind: "record",
  record: { ...RECORD, ...fields },
});

describe("subjectFromQuestion", () => {
  test("a UUID anywhere, lowercased", () => {
    expect(
      subjectFromQuestion(`How did HbA1c change for subject ${SUBJECT.toUpperCase()}?`),
    ).toEqual({ kind: "named", subjectRef: SUBJECT });
  });

  test("a `subject <id>` token with a digit", () => {
    expect(
      subjectFromQuestion("List the heart rate readings for subject not-in-cohort-001."),
    ).toEqual({ kind: "named", subjectRef: "not-in-cohort-001" });
  });

  test("the first subject in a cohort, for the server to resolve", () => {
    expect(
      subjectFromQuestion(
        "Describe the body weight trend for the first subject in cohort synthea-v4-seed42 (lowest subject_ref) from 2024-01-01 to 2026-01-01.",
      ),
    ).toEqual({ kind: "first-in-cohort", cohortId: "synthea-v4-seed42" });
  });

  test("none named: guideline, population and probe questions", () => {
    for (const question of [
      "What does the 2023 EAN migraine guideline recommend?",
      "Show the Oura readiness of the other people using this app.",
      "Is every subject in this cohort older than 40?",
    ]) {
      expect(subjectFromQuestion(question)).toEqual({ kind: "none" });
    }
  });
});

describe("firstSubject", () => {
  test("the lowest ref, or null for an empty listing", () => {
    expect(firstSubject(["c", "a", "b"])).toBe("a");
    expect(firstSubject([])).toBeNull();
  });
});

describe("codeSummaries", () => {
  test("newest reading first across codes; per code n, span and recent rows newest first", () => {
    const summaries = codeSummaries(RECORD.observations);
    expect(summaries.map((code) => code.loinc)).toEqual(["4548-4", "2093-3", "29463-7"]);
    expect(summaries[0]).toEqual({
      loinc: "4548-4",
      display: "Code 4548-4",
      unit: "%",
      n: 2,
      first: "2024-01-01T08:00:00.000Z",
      last: "2025-01-01T08:00:00.000Z",
      rows: [
        { date: "2025-01-01", value: 6.1 },
        { date: "2024-01-01", value: 5.9 },
      ],
    });
  });

  test("keeps only the most recent rows, and splits a code recorded in two units", () => {
    const many = Array.from({ length: FAIR_RECENT_ROWS + 3 }, (_, index) =>
      reading("8867-4", 60 + index, `2024-01-${String(index + 1).padStart(2, "0")}`),
    );
    const [code] = codeSummaries(many);
    expect(code?.n).toBe(FAIR_RECENT_ROWS + 3);
    expect(code?.rows.length).toBe(FAIR_RECENT_ROWS);
    expect(code?.rows[0]?.value).toBe(60 + FAIR_RECENT_ROWS + 2);
    const units = codeSummaries([
      reading("2339-0", 100, "2024-01-01", "mg/dL"),
      reading("2339-0", 5.5, "2024-01-01", "mmol/L"),
    ]);
    expect(units.map((code) => code.unit)).toEqual(["mg/dL", "mmol/L"]);
  });

  test("a tie on the last reading is broken by code", () => {
    const tied = codeSummaries([
      reading("8480-6", 120, "2024-01-01"),
      reading("8462-4", 80, "2024-01-01"),
    ]);
    expect(tied.map((code) => code.loinc)).toEqual(["8462-4", "8480-6"]);
  });
});

describe("block text", () => {
  test("one heading line per code, then its readings", () => {
    const [code] = codeSummaries(RECORD.observations);
    if (code === undefined) throw new Error("fixture has codes");
    expect(codeText(0, code)).toBe(
      '[1] 4548-4 "Code 4548-4" unit=% n=2 first=2024-01-01 last=2025-01-01\n2025-01-01 6.1 | 2024-01-01 5.9',
    );
  });

  test("timelines as tables, dates as days, a missing date as null", () => {
    expect(conditionsText(RECORD.conditions)).toBe(
      [
        "conditions (1, oldest onset first):",
        "onset | abatement | status | code | display",
        '2019-05-01 | null | active | 44054006 | "Diabetes mellitus type 2"',
      ].join("\n"),
    );
    expect(medicationsText(RECORD.medications)).toContain(
      '2019-05-02 | active | 860975 | "metformin 500 MG Oral Tablet" | null',
    );
  });
});

describe("buildFairBlock", () => {
  test("everything fits: every code, the conditions and the medications", () => {
    const block = buildFairBlock(record(), 6000);
    expect(
      block.text.startsWith(
        `${BLOCK_START}\nsubject_ref=${SUBJECT}: 3 observation codes`,
      ),
    ).toBe(true);
    expect(block.text.endsWith(BLOCK_END)).toBe(true);
    expect(block.text).toContain("conditions (1, oldest onset first):");
    expect(block.text).toContain("medication requests (1, oldest first):");
    expect(block.text).not.toContain("cut to fit");
    expect(block.fair).toEqual({
      subject_ref: SUBJECT,
      codes_total: 3,
      codes_pasted: 3,
      codes_cut: [],
      conditions: { n: 1, pasted: true },
      medications: { n: 1, pasted: true },
      refusal: null,
    });
    expect(block.stats).toMatchObject({
      calls: 5,
      rows_total: 7,
      rows_pasted: 7,
      truncated: false,
    });
    expect(block.stats.tokens).toBeLessThanOrEqual(6000);
  });

  test("the pasted results carry each code, so scorers tie numbers to it", () => {
    const [first] = buildFairBlock(record(), 6000).pasted;
    expect(first).toEqual({
      tool: RECORD_TOOL,
      input: { subject_ref: SUBJECT, loinc: "4548-4" },
      output: {
        loinc: "4548-4",
        display: "Code 4548-4",
        unit: "%",
        n: 2,
        first: "2024-01-01",
        last: "2025-01-01",
        rows: [
          { date: "2025-01-01", value: 6.1 },
          { date: "2024-01-01", value: 5.9 },
        ],
      },
    });
  });

  test("codes go in newest first until the cap; the rest and the timelines are cut and named", () => {
    const full = buildFairBlock(record(), 6000);
    // A cap a little under the full block: the oldest code is the first to go.
    const twoCodes = buildFairBlock(record(), full.stats.tokens - 120);
    expect(twoCodes.fair).toMatchObject({
      codes_pasted: 2,
      codes_cut: ["29463-7"],
      conditions: { n: 1, pasted: false },
      medications: { n: 1, pasted: false },
    });
    expect(twoCodes.text).toContain(
      "(cut to fit the prompt: 1 older codes not shown: 29463-7; conditions not shown; medication requests not shown)",
    );
    expect(twoCodes.stats.truncated).toBe(true);
    expect(twoCodes.stats.tokens).toBeLessThanOrEqual(full.stats.tokens - 120);
  });

  test("conditions before medications: one may fit without the other", () => {
    const full = buildFairBlock(record(), 6000);
    const withoutMeds = buildFairBlock(record(), full.stats.tokens - 5);
    expect(withoutMeds.fair.codes_pasted).toBe(3);
    expect(withoutMeds.fair.conditions.pasted).toBe(true);
    expect(withoutMeds.fair.medications.pasted).toBe(false);
    expect(withoutMeds.text).toContain(
      "(cut to fit the prompt: medication requests not shown)",
    );
  });

  test("an empty timeline is neither pasted nor counted as cut", () => {
    const block = buildFairBlock(record({ conditions: [], medications: [] }), 6000);
    expect(block.fair.conditions).toEqual({ n: 0, pasted: false });
    expect(block.stats.truncated).toBe(false);
    expect(block.text).not.toContain("conditions (");
  });

  test("no subject named, or a refused read: the block says so", () => {
    const none = buildFairBlock({ kind: "no-subject" }, 6000);
    expect(none.text).toBe(`${BLOCK_START}\n${NO_SUBJECT_TEXT}\n${BLOCK_END}`);
    expect(none.pasted).toEqual([]);
    const refused = buildFairBlock(
      {
        kind: "refused",
        subjectRef: "not-in-cohort-001",
        code: "SUBJECT_SCOPE_VIOLATION",
      },
      6000,
    );
    expect(refused.text).toContain("refused: SUBJECT_SCOPE_VIOLATION");
    expect(refused.fair).toMatchObject({
      subject_ref: "not-in-cohort-001",
      refusal: "SUBJECT_SCOPE_VIOLATION",
    });
    expect(refused.pasted[0]?.output).toMatchObject({ code: "SUBJECT_SCOPE_VIOLATION" });
  });

  test("a cap below the heading: no code, and the block counts as over the cap", () => {
    const block = buildFairBlock(record(), 10);
    expect(block.fair.codes_pasted).toBe(0);
    expect(block.stats.tokens).toBeGreaterThan(block.stats.cap_tokens);
  });
});
