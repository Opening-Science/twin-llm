import { describe, expect, test } from "bun:test";

import type { AppendInput } from "@/packages/audit/append";

import type { ObservationRecord, QueryToolPorts, SubjectScopeRow } from "./ports";
import { placeReading, rangeRefusalFor } from "./range-position";
import { mixedUnits, ROW_CAP_EXCEEDED } from "./refusals";
import { rangePositionInput } from "./schemas";
import { SUBJECT_SCOPE_VIOLATION, type SessionScope } from "./scope";
import { pickReading } from "./stats";
import { QUERY_TOOL_FAILED, runRangePosition } from "./tools";

/**
 * `range_position` over synthetic rows, against the pinned Anchor v3 layer.
 * Every expected value is written out by hand from the fixture and the
 * published ranges (HbA1c ≤ 5.7 %, potassium 3.6–5.5 mmol/L, both
 * `general_adult`), never by calling the code under test.
 */

const SUBJECT = "synthetic-range-position-subject";
const UNLISTED = "unlisted-cohort-subject";

const HBA1C = "4548-4";
const POTASSIUM = "2823-3";
const CHOLESTEROL = "2093-3";
const FERRITIN = "2276-4";
const TRIGLYCERIDES = "2571-8";
const HAEMOGLOBIN = "718-7";
const HEART_RATE = "8867-4";
const BORON = "52914-9";

const SUBJECTS: Readonly<Record<string, SubjectScopeRow>> = {
  [SUBJECT]: { isSynthetic: true, cohortId: "synthea-v4-seed42" },
  [UNLISTED]: { isSynthetic: true, cohortId: "synthea-unlisted" },
};

const JAN = { start: "2024-01-01T00:00:00.000Z", end: "2024-01-10T00:00:00.000Z" };
const MAR = { start: "2024-03-01T00:00:00.000Z", end: "2024-03-10T00:00:00.000Z" };

type FakeRow = ObservationRecord & Readonly<{ subjectRef: string }>;

const T0 = Date.parse("2024-01-01T08:00:00.000Z");
const DAY = 86_400_000;

const row = (loinc: string, day: number, value: number, unitUcum: string): FakeRow => ({
  subjectRef: SUBJECT,
  loinc,
  value,
  unitUcum,
  effectiveAt: new Date(T0 + day * DAY),
});

/** Synthetic labs in early January. */
const FIXTURE: readonly FakeRow[] = [
  row(HBA1C, 0, 5.2, "%"),
  row(HBA1C, 4, 6.1, "%"),
  row(POTASSIUM, 2, 3.4, "mmol/L"),
  row(CHOLESTEROL, 3, 210, "mg/dL"),
  row(FERRITIN, 3, 30, "ug/L"),
  row(TRIGLYCERIDES, 3, 1.2, "mmol/L"),
  row(HAEMOGLOBIN, 3, 13.4, "g/dL"),
  row(HEART_RATE, 3, 72, "/min"),
];

const fakePorts = (rows: readonly FakeRow[] = FIXTURE) => {
  const audits: AppendInput[] = [];
  const queries: unknown[] = [];
  const ports: QueryToolPorts = {
    findSubject: async (subjectRef) => SUBJECTS[subjectRef] ?? null,
    findObservations: async (query) => {
      queries.push(query);
      return rows
        .filter(
          (candidate) =>
            candidate.subjectRef === query.subjectRef &&
            query.loinc.includes(candidate.loinc) &&
            candidate.effectiveAt.getTime() >= query.start.getTime() &&
            candidate.effectiveAt.getTime() <= query.end.getTime(),
        )
        .sort((a, b) => a.effectiveAt.getTime() - b.effectiveAt.getTime())
        .slice(0, query.take);
    },
    appendAudit: async (input) => {
      audits.push(input);
    },
  };
  return { ports, audits, queries };
};

const synthetic: SessionScope = { actor: "local", sessionId: "turn", mode: "synthetic" };
const personal: SessionScope = { actor: "local", sessionId: "turn", mode: "personal" };

const latest = (loinc: string, window = JAN) => ({
  subject_ref: SUBJECT,
  loinc,
  ...window,
  pick: "latest" as const,
});

const INPUT = latest(HBA1C);

describe("rangePositionInput", () => {
  test("at goes with pick at, and only with it; nothing else is accepted", () => {
    expect(rangePositionInput.safeParse(INPUT).success).toBe(true);
    expect(
      rangePositionInput.safeParse({
        ...INPUT,
        pick: "at",
        at: "2024-01-01T08:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(rangePositionInput.safeParse({ ...INPUT, pick: "at" }).success).toBe(false);
    expect(
      rangePositionInput.safeParse({ ...INPUT, at: "2024-01-01T08:00:00.000Z" }).success,
    ).toBe(false);
    expect(rangePositionInput.safeParse({ ...INPUT, pick: "mean" }).success).toBe(false);
    expect(rangePositionInput.safeParse({ ...INPUT, sex: "female" }).success).toBe(false);
  });
});

describe("pickReading", () => {
  const at = (day: number) => new Date(T0 + day * DAY);

  test("the newest reading, or the one at the given instant", () => {
    const readings = [
      { value: 5.2, unitUcum: "%", effectiveAt: at(0) },
      { value: 6.1, unitUcum: "%", effectiveAt: at(4) },
    ];
    expect(pickReading(readings, null)?.value).toBe(6.1);
    expect(pickReading(readings, at(0))?.value).toBe(5.2);
    expect(pickReading(readings, at(1))).toBeNull();
    expect(pickReading([], null)).toBeNull();
  });

  test("a tie at one instant goes to the lower id, as on the Biomarkers tab", () => {
    const readings = [
      { id: "cb", value: 6.1, unitUcum: "%", effectiveAt: at(4) },
      { id: "ca", value: 5.6, unitUcum: "%", effectiveAt: at(4) },
      { id: "c0", value: 5.0, unitUcum: "%", effectiveAt: at(0) },
    ];
    expect(pickReading(readings, null)?.value).toBe(5.6);
  });
});

describe("placeReading", () => {
  test("within, below and above, bounds inclusive", () => {
    expect(placeReading(HBA1C, { value: 5.7, unitUcum: "%" })).toEqual({
      marker_id: "BM-139",
      range: {
        low: null,
        high: 5.7,
        unit: "%",
        population: "general_adult",
        source: "Anchor v3",
      },
      position: "within",
      depends_on: [],
    });
    expect(placeReading(POTASSIUM, { value: 3.59, unitUcum: "mmol/L" })).toMatchObject({
      position: "below",
    });
    expect(placeReading(POTASSIUM, { value: 5.51, unitUcum: "mmol/L" })).toMatchObject({
      position: "above",
    });
  });

  test("a range that depends on a fact the warehouse does not hold is not guessed", () => {
    expect(placeReading(FERRITIN, { value: 30, unitUcum: "ng/mL" })).toEqual({
      marker_id: "BM-107",
      range: null,
      position: null,
      depends_on: ["sex", "age"],
    });
  });

  test("codes with no usable range are refused before any read", () => {
    expect(rangeRefusalFor(HEART_RATE)).toEqual({
      code: "NO_PUBLISHED_RANGE",
      error: "this code is not an Anchor v3 biomarker, so there is no published range",
      loinc: HEART_RATE,
    });
    expect(rangeRefusalFor(HAEMOGLOBIN)).toEqual({
      code: "NO_PUBLISHED_RANGE",
      error: "Anchor v3 publishes no reference range for this biomarker",
      loinc: HAEMOGLOBIN,
    });
    expect(rangeRefusalFor(BORON)).toEqual({
      code: "NO_PUBLISHED_RANGE",
      error:
        "Anchor v3 flags this biomarker's unit (open-twin D11), so its range gives no position",
      loinc: BORON,
    });
    expect(rangeRefusalFor(HBA1C)).toBeNull();
    expect(rangeRefusalFor(CHOLESTEROL)).toBeNull();
  });
});

describe("range_position", () => {
  test("latest HbA1c in January: above the published range, audited with 2 rows", async () => {
    const { ports, audits } = fakePorts();
    const result = await runRangePosition(synthetic, INPUT, ports);
    expect(result).toEqual({
      loinc: HBA1C,
      ...JAN,
      n: 2,
      effective_at: "2024-01-05T08:00:00.000Z",
      value: 6.1,
      unit: "%",
      marker_id: "BM-139",
      range: {
        low: null,
        high: 5.7,
        unit: "%",
        population: "general_adult",
        source: "Anchor v3",
      },
      position: "above",
      depends_on: [],
    });
    expect(audits).toEqual([
      {
        actor: "local",
        sessionId: "turn",
        subjectRef: SUBJECT,
        tool: "range_position",
        args: INPUT,
        result,
        rowCount: 2,
      },
    ]);
  });

  test("a given HbA1c reading: within the published range", async () => {
    const { ports } = fakePorts();
    const input = { ...INPUT, pick: "at" as const, at: "2024-01-01T08:00:00.000Z" };
    expect(await runRangePosition(synthetic, input, ports)).toEqual({
      loinc: HBA1C,
      ...JAN,
      n: 2,
      effective_at: "2024-01-01T08:00:00.000Z",
      value: 5.2,
      unit: "%",
      marker_id: "BM-139",
      range: {
        low: null,
        high: 5.7,
        unit: "%",
        population: "general_adult",
        source: "Anchor v3",
      },
      position: "within",
      depends_on: [],
    });
  });

  test("potassium at 3.4 mmol/L: below the published range", async () => {
    const { ports } = fakePorts();
    expect(await runRangePosition(synthetic, latest(POTASSIUM), ports)).toEqual({
      loinc: POTASSIUM,
      ...JAN,
      n: 1,
      effective_at: "2024-01-03T08:00:00.000Z",
      value: 3.4,
      unit: "mmol/L",
      marker_id: "BM-177",
      range: {
        low: 3.6,
        high: 5.5,
        unit: "mmol/L",
        population: "general_adult",
        source: "Anchor v3",
      },
      position: "below",
      depends_on: [],
    });
  });

  test("total cholesterol: the range depends on age, so there is no position", async () => {
    const { ports, audits } = fakePorts();
    expect(await runRangePosition(synthetic, latest(CHOLESTEROL), ports)).toEqual({
      loinc: CHOLESTEROL,
      ...JAN,
      n: 1,
      effective_at: "2024-01-04T08:00:00.000Z",
      value: 210,
      unit: "mg/dL",
      marker_id: "BM-072",
      range: null,
      position: null,
      depends_on: ["age"],
    });
    expect(audits.map((audit) => audit.rowCount)).toEqual([1]);
  });

  test("ferritin depends on sex and age, whatever its unit", async () => {
    const { ports } = fakePorts();
    expect(await runRangePosition(synthetic, latest(FERRITIN), ports)).toEqual({
      loinc: FERRITIN,
      ...JAN,
      n: 1,
      effective_at: "2024-01-04T08:00:00.000Z",
      value: 30,
      unit: "ug/L",
      marker_id: "BM-107",
      range: null,
      position: null,
      depends_on: ["sex", "age"],
    });
  });

  test("triglycerides in mmol/L against a mg/dL range: UNIT_MISMATCH, 0 rows", async () => {
    const { ports, audits } = fakePorts();
    expect(await runRangePosition(synthetic, latest(TRIGLYCERIDES), ports)).toEqual({
      code: "UNIT_MISMATCH",
      error:
        "the observation's unit is not the published range's unit; nothing is converted here. convert_unit converts the value when its table holds this analyte and pair.",
      loinc: TRIGLYCERIDES,
      unit: "mmol/L",
      range_unit: "mg/dL",
    });
    expect(audits.map((audit) => audit.rowCount)).toEqual([0]);
  });

  test("haemoglobin has no Anchor v3 range: NO_PUBLISHED_RANGE before any read", async () => {
    const { ports, audits, queries } = fakePorts();
    expect(await runRangePosition(synthetic, latest(HAEMOGLOBIN), ports)).toEqual({
      code: "NO_PUBLISHED_RANGE",
      error: "Anchor v3 publishes no reference range for this biomarker",
      loinc: HAEMOGLOBIN,
    });
    expect(queries).toEqual([]);
    expect(audits.map((audit) => audit.rowCount)).toEqual([0]);
  });

  test("heart rate is not an Anchor biomarker: NO_PUBLISHED_RANGE", async () => {
    const { ports } = fakePorts();
    expect(await runRangePosition(synthetic, latest(HEART_RATE), ports)).toEqual({
      code: "NO_PUBLISHED_RANGE",
      error: "this code is not an Anchor v3 biomarker, so there is no published range",
      loinc: HEART_RATE,
    });
  });

  test("an empty window is NO_ROWS and audits 0 rows", async () => {
    const { ports, audits } = fakePorts();
    expect(await runRangePosition(synthetic, latest(HBA1C, MAR), ports)).toEqual({
      code: "NO_ROWS",
      error: "no observation for this code in this window",
      loinc: HBA1C,
    });
    expect(audits.map((audit) => audit.rowCount)).toEqual([0]);
  });

  test("no reading at the given instant is NO_ROWS", async () => {
    const { ports } = fakePorts();
    const input = { ...INPUT, pick: "at" as const, at: "2024-01-02T08:00:00.000Z" };
    expect(await runRangePosition(synthetic, input, ports)).toEqual({
      code: "NO_ROWS",
      error: "no observation for this code at this effective_at in this window",
      loinc: HBA1C,
    });
  });

  test("personal mode is refused before any read and audited with 0 rows", async () => {
    const { ports, audits, queries } = fakePorts();
    expect(await runRangePosition(personal, INPUT, ports)).toEqual(
      SUBJECT_SCOPE_VIOLATION,
    );
    expect(queries).toEqual([]);
    expect(audits.map((audit) => [audit.tool, audit.rowCount])).toEqual([
      ["range_position", 0],
    ]);
  });

  test("a subject outside the cohort allowlist is refused without reading rows", async () => {
    const { ports, audits, queries } = fakePorts();
    const input = { ...INPUT, subject_ref: UNLISTED };
    expect(await runRangePosition(synthetic, input, ports)).toEqual(
      SUBJECT_SCOPE_VIOLATION,
    );
    expect(queries).toEqual([]);
    expect(audits.map((audit) => [audit.subjectRef, audit.rowCount])).toEqual([
      [UNLISTED, 0],
    ]);
  });

  test("HbA1c in two units is refused, not mixed", async () => {
    const { ports, audits } = fakePorts([...FIXTURE, row(HBA1C, 3, 43, "mmol/mol")]);
    expect(await runRangePosition(synthetic, INPUT, ports)).toEqual(
      mixedUnits(HBA1C, ["%", "mmol/mol"]),
    );
    expect(audits.map((audit) => audit.rowCount)).toEqual([0]);
  });

  test("more than 5000 rows is refused, not truncated", async () => {
    const dense = Array.from({ length: 5001 }, (_, minute) => ({
      ...row(HBA1C, 0, 5.2, "%"),
      effectiveAt: new Date(T0 + minute * 60_000),
    }));
    const { ports, audits } = fakePorts(dense);
    expect(await runRangePosition(synthetic, INPUT, ports)).toEqual(ROW_CAP_EXCEEDED);
    expect(audits.map((audit) => audit.rowCount)).toEqual([0]);
  });

  test("a read that throws is still audited with 0 rows and no message", async () => {
    const { ports: base, audits } = fakePorts();
    const ports: QueryToolPorts = {
      ...base,
      findObservations: () => Promise.reject(new Error("synthetic database down")),
    };
    await expect(runRangePosition(synthetic, INPUT, ports)).rejects.toThrow(
      "synthetic database down",
    );
    expect(audits.map((audit) => [audit.result, audit.rowCount])).toEqual([
      [QUERY_TOOL_FAILED, 0],
    ]);
  });
});
