import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { DAY_THRESHOLDS, type DayReading, dayBeats, redWindows } from "./day-beats";
import MOCK_DAY from "./fixtures/mock-day.json";
import {
  KIOSK_DAY_NOTICE,
  KIOSK_DAY_SCHEMA_VERSION,
  type KioskDaySource,
  kioskDaySchema,
  toKioskDay,
} from "./kiosk-day";

/** The illustrative mock day: hand-written values, not a recording of anyone. */
const READINGS: readonly DayReading[] = MOCK_DAY.readings.map((one) => ({
  time: one.time,
  event: one.event,
  heartRatePerMin: one.heart_rate_per_min,
  glucoseMgDl: one.glucose_mg_dl,
  moving: one.moving,
}));

/** The mock day as `show_my_day` would return it, activity included. */
const SOURCE: KioskDaySource = {
  subject_ref: "synthetic-mock-day",
  day: MOCK_DAY.day,
  profile: "without_diabetes",
  beats: dayBeats(READINGS, "without_diabetes"),
  red_windows: redWindows(READINGS, "without_diabetes"),
  thresholds: { status: DAY_THRESHOLDS.status, reviewer: DAY_THRESHOLDS.reviewer },
  activity: "recorded",
  timezone: "UTC",
};

const EXAMPLE: unknown = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../docs/kiosk-day.example.json", import.meta.url)),
    "utf8",
  ),
);

describe("toKioskDay on the mock day", () => {
  const kiosk = toKioskDay(SOURCE);

  test("is the committed example, which parses against the contract", () => {
    expect(kioskDaySchema.parse(EXAMPLE)).toEqual(kiosk);
  });

  test("carries the version, the notice, and one entry per beat", () => {
    expect(kiosk.schema_version).toBe(KIOSK_DAY_SCHEMA_VERSION);
    expect(kiosk.notice).toBe(KIOSK_DAY_NOTICE);
    expect(kiosk.beats).toHaveLength(SOURCE.beats.length);
  });

  test("the after-dinner window is the only one worth a look", () => {
    expect(kiosk.beats.filter((beat) => beat.worth_a_look)).toEqual([
      {
        time: "20:30",
        event: "Worth a look",
        source: "derived",
        measure: "glucose",
        direction: "up",
        value: 175,
        unit: "mg/dL",
        line: "Blood glucose up · about 175 mg/dL · derived",
        body: {
          text: "Blood sugar stays past the threshold for a while. Blood glucose above 140 mg/dL (placeholder, without diabetes).",
          organ: "bloodvasculature",
        },
        view: { focus: "bloodvasculature", depth: "organs" },
        worth_a_look: true,
      },
    ]);
    expect(kiosk.worth_a_look).toEqual([
      {
        from: "20:30",
        to: "20:30",
        measure: "glucose",
        extreme: 175,
        unit: "mg/dL",
        rule: "Blood glucose above 140 mg/dL (placeholder, without diabetes)",
      },
    ]);
  });

  test("insulin beats are narrated with no number, and say so on their line", () => {
    const insulin = kiosk.beats.filter((beat) => beat.measure === "insulin");
    expect(insulin).toHaveLength(3);
    for (const beat of insulin) {
      expect([beat.source, beat.value, beat.unit]).toEqual(["narrated", null, null]);
      expect(beat.line).toBe("Insulin up · narrated, not measured");
    }
  });
});

describe("kioskDaySchema", () => {
  const kiosk = toKioskDay(SOURCE);
  const [first] = kiosk.beats;

  test("refuses a narrated beat with a value, a measured insulin, and worth a look on a measured beat", () => {
    if (first === undefined) throw new Error("the mock day has beats");
    const withBeat = (beat: object) => ({ ...kiosk, beats: [{ ...first, ...beat }] });
    expect(kioskDaySchema.safeParse(withBeat({ source: "narrated" })).success).toBe(
      false,
    );
    expect(
      kioskDaySchema.safeParse(
        withBeat({ measure: "insulin", source: "measured", value: 5, unit: "/min" }),
      ).success,
    ).toBe(false);
    expect(kioskDaySchema.safeParse(withBeat({ worth_a_look: true })).success).toBe(
      false,
    );
  });

  test("refuses an unknown field and another schema version", () => {
    expect(kioskDaySchema.safeParse({ ...kiosk, extra: 1 }).success).toBe(false);
    expect(
      kioskDaySchema.safeParse({ ...kiosk, schema_version: "twin-llm.kiosk-day.v2" })
        .success,
    ).toBe(false);
  });
});
