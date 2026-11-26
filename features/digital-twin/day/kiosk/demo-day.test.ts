import { describe, expect, test } from "bun:test";

import { KIOSK_DAY_NOTICE } from "@/packages/query-tools/kiosk-day";

import { type CohortRow } from "../../biomarkers/cohort-handler";
import { dayList, demoDay, MOCK_DAY_REF, mockDay } from "./demo-day";

const row = (
  id: string,
  loinc: string,
  value: number,
  at: string,
  unitUcum = loinc === "8867-4" ? "/min" : "mg/dL",
): CohortRow => ({ id, loinc, value, unitUcum, effectiveAt: new Date(at) });

/** Made-up synthetic rows: two days, and a lab value that is not a day code. */
const ROWS: readonly CohortRow[] = [
  row("a", "8867-4", 62, "2026-11-15T07:00:00Z"),
  row("b", "2339-0", 95, "2026-11-15T07:00:00Z"),
  row("c", "8867-4", 64, "2026-11-15T12:00:00Z"),
  row("d", "2339-0", 182, "2026-11-15T12:00:00Z"),
  row("e", "8867-4", 70, "2026-11-14T12:00:00Z"),
  row("f", "4548-4", 5.4, "2026-11-15T09:00:00Z", "%"),
];

describe("dayList", () => {
  test("lists days with heart rate or glucose, newest first, counting their rows", () => {
    expect(dayList(ROWS)).toEqual([
      { day: "2026-11-15", readings: 4 },
      { day: "2026-11-14", readings: 1 },
    ]);
  });

  test("is empty with no day codes", () => {
    expect(dayList([ROWS[5]!])).toEqual([]);
  });
});

describe("demoDay", () => {
  test("builds the day with show_my_day's functions, as a kiosk day", () => {
    const result = demoDay(ROWS, "syn-a", "2026-11-15", "without_diabetes");
    if (result.kind !== "day") throw new Error("expected a day");
    expect(result.day.subject_ref).toBe("syn-a");
    expect(result.day.notice).toBe(KIOSK_DAY_NOTICE);
    expect(result.day.activity).toBe("not recorded");
    expect(result.day.beats.map((beat) => beat.time)).toContain("07:00");
    // 182 mg/dL is past the placeholder 140 without diabetes: one window.
    expect(result.day.worth_a_look).toHaveLength(1);
    expect(result.day.worth_a_look[0]).toMatchObject({ from: "12:00", extreme: 182 });
  });

  test("reads only the asked day", () => {
    const result = demoDay(ROWS, "syn-a", "2026-11-14", "without_diabetes");
    if (result.kind !== "day") throw new Error("expected a day");
    expect(result.day.beats.every((beat) => beat.time === "12:00")).toBe(true);
    expect(result.day.worth_a_look).toEqual([]);
  });

  test("reads sensor glucose as its own measure", () => {
    const sensor = [...ROWS, row("s", "99504-3", 101, "2026-11-15T09:00:00Z", "mg/dL")];
    expect(dayList(sensor)[0]).toEqual({ day: "2026-11-15", readings: 5 });
    const result = demoDay(sensor, "syn-a", "2026-11-15", "without_diabetes");
    if (result.kind !== "day") throw new Error("expected a day");
    expect(result.day.beats.some((beat) => beat.line.startsWith("Sensor glucose"))).toBe(
      true,
    );
  });

  test("refuses a day with no readings", () => {
    expect(demoDay(ROWS, "syn-a", "2026-11-01", "without_diabetes")).toEqual({
      kind: "refused",
      reason: "no-readings",
    });
  });

  test("refuses a unit it would have to convert", () => {
    const mmol = [...ROWS, row("g", "2339-0", 6.1, "2026-11-15T18:00:00Z", "mmol/L")];
    expect(demoDay(mmol, "syn-a", "2026-11-15", "without_diabetes")).toEqual({
      kind: "refused",
      reason: "units",
    });
  });
});

describe("mockDay", () => {
  test("is the illustrative mock, labelled with its own ref and activity", () => {
    const day = mockDay("without_diabetes");
    expect(day.subject_ref).toBe(MOCK_DAY_REF);
    expect(day.activity).toBe("recorded");
    expect(day.beats.length).toBeGreaterThan(0);
    // Blood and sensor glucose side by side: each passes the threshold at 20:30.
    expect(
      day.beats.filter((beat) => beat.worth_a_look).map((beat) => beat.line),
    ).toEqual([
      "Blood glucose up · about 175 mg/dL · derived",
      "Sensor glucose up · about 152 mg/dL · derived",
    ]);
  });

  test("follows the profile's thresholds", () => {
    expect(mockDay("with_diabetes").profile).toBe("with_diabetes");
  });
});
