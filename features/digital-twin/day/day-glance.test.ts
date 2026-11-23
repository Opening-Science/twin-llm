import { describe, expect, test } from "bun:test";

import {
  KIOSK_DAY_NOTICE,
  KIOSK_DAY_SCHEMA_VERSION,
  type KioskDay,
} from "@/packages/query-tools/kiosk-day";

import {
  dayGlance,
  DAY_GLANCE_FAILED,
  DAY_GLANCE_NO_PEOPLE,
  DAY_GLANCE_SYNTHETIC,
} from "./day-glance";

const beat = (time: string, worth: boolean): KioskDay["beats"][number] =>
  ({
    time,
    event: "Reading",
    source: worth ? "derived" : "measured",
    measure: "heart_rate",
    specimen: null,
    direction: "steady",
    value: 70,
    unit: "/min",
    line: `Heart rate at ${time}`,
    twin: null,
    view: null,
    worth_a_look: worth,
  }) as unknown as KioskDay["beats"][number];

const window = (from: string, extreme: number): KioskDay["worth_a_look"][number] => ({
  from,
  to: from,
  measure: "glucose",
  specimen: "blood",
  extreme,
  unit: "mg/dL",
  rule: "Above the placeholder threshold.",
});

const day = (windows: KioskDay["worth_a_look"]): KioskDay =>
  ({
    schema_version: KIOSK_DAY_SCHEMA_VERSION,
    notice: KIOSK_DAY_NOTICE,
    subject_ref: "synthetic-glance",
    day: "2026-11-16",
    profile: "without_diabetes",
    beats: [beat("08:00", false), beat("12:30", true), beat("20:30", true)],
    worth_a_look: windows,
    thresholds: { status: "placeholder", reviewer: "Robin" },
    activity: "not recorded",
    timezone: "UTC",
  }) as KioskDay;

describe("dayGlance", () => {
  test("a synthetic person's day: who and when, how many beats, and its windows", () => {
    expect(
      dayGlance({
        day: day([window("12:30", 162), window("20:30", 171)]),
        personLabel: "Synthetic person 1",
        mock: false,
      }),
    ).toEqual({
      heading: "Synthetic person 1 · 16 Nov 2026",
      summary: "3 beats of heart rate and blood sugar · 2 worth a look",
      worth: [
        "12:30 · Blood glucose · furthest 162 mg/dL",
        "20:30 · Blood glucose · furthest 171 mg/dL",
      ],
      more: null,
      notes: [KIOSK_DAY_NOTICE, "Times are UTC."],
    });
  });

  test("the mock day says it is made up, and only three windows are listed", () => {
    const glance = dayGlance({
      day: day([
        window("09:00", 150),
        window("12:30", 162),
        window("17:00", 158),
        window("20:30", 171),
      ]),
      personLabel: "Synthetic person 1",
      mock: true,
    });
    expect(glance.heading).toBe("Illustrative day (mock)");
    expect(glance.worth).toHaveLength(3);
    expect(glance.more).toBe("and 1 more on the Digital Twin page");
    expect(glance.notes).toEqual([
      "Illustrative mock: made-up values for a made-up person, not this person's readings.",
      KIOSK_DAY_NOTICE,
      "Times are UTC.",
    ]);
  });

  test("a day with nothing past the thresholds says so", () => {
    const glance = dayGlance({
      day: day([]),
      personLabel: "Synthetic person 2",
      mock: false,
    });
    expect(glance.summary).toBe(
      "3 beats of heart rate and blood sugar · none worth a look",
    );
    expect(glance.worth).toEqual([]);
  });

  test("the words around it", () => {
    expect(DAY_GLANCE_SYNTHETIC).toBe("Synthetic data");
    expect(DAY_GLANCE_NO_PEOPLE).toBe(
      "No synthetic people in this database yet, so there is no day to show here.",
    );
    expect(DAY_GLANCE_FAILED).toBe(
      "Could not load the synthetic people, so there is no day to show here.",
    );
  });
});
