import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { DAY_THRESHOLDS, type DayReading, dayBeats, redWindows } from "./day-beats";
import { MOCK_DAY_DATE, mockDayReadings } from "./mock-day";
import { mockKioskDay } from "./mock-kiosk-day";
import {
  KIOSK_DAY_NOTICE,
  KIOSK_DAY_SCHEMA_VERSION,
  type KioskDaySource,
  kioskDaySchema,
  toKioskDay,
} from "./kiosk-day";

/** The mock day as `show_my_day` would return it, activity included. */
const sourceOf = (readings: readonly DayReading[]): KioskDaySource => ({
  subject_ref: "synthetic-mock-day",
  day: MOCK_DAY_DATE,
  profile: "without_diabetes",
  beats: dayBeats(readings, "without_diabetes"),
  red_windows: redWindows(readings, "without_diabetes"),
  thresholds: { status: DAY_THRESHOLDS.status, reviewer: DAY_THRESHOLDS.reviewer },
  activity: "recorded",
  timezone: "UTC",
});

/** The illustrative mock day: hand-written values, not a recording of anyone. */
const SOURCE = sourceOf(mockDayReadings("blood"));

const example = (name: string): unknown =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../../docs/${name}`, import.meta.url)), "utf8"),
  );

const EXAMPLE = example("kiosk-day.example.json");

describe("toKioskDay on the mock day from a monitor wearer", () => {
  const kiosk = toKioskDay(sourceOf(mockDayReadings("sensor")));

  test("the mock builds the committed sensor example, which parses against the contract", () => {
    expect(kioskDaySchema.parse(example("kiosk-day.sensor.example.json"))).toEqual(
      mockKioskDay("without_diabetes", "sensor"),
    );
  });

  test("every glucose value says sensor, and so does its line", () => {
    const glucose = kiosk.beats.filter((beat) => beat.measure === "glucose");
    expect(glucose.map((beat) => [beat.time, beat.specimen, beat.line])).toEqual([
      ["19:30", "sensor", "Sensor glucose up · about 98 mg/dL · measured"],
      ["20:30", "sensor", "Sensor glucose up · about 152 mg/dL · measured"],
      ["20:30", "sensor", "Sensor glucose up · about 152 mg/dL · derived"],
      ["22:30", "sensor", "Sensor glucose down · about 112 mg/dL · measured"],
    ]);
    expect(kiosk.worth_a_look).toEqual([
      {
        from: "20:30",
        to: "20:30",
        measure: "glucose",
        specimen: "sensor",
        extreme: 152,
        unit: "mg/dL",
        rule: "Sensor glucose above 140 mg/dL (placeholder, without diabetes)",
      },
    ]);
  });
});

describe("toKioskDay on the mock day", () => {
  const kiosk = toKioskDay(SOURCE);

  test("the mock builds the committed example, which parses against the contract", () => {
    expect(kioskDaySchema.parse(EXAMPLE)).toEqual(mockKioskDay("without_diabetes"));
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
        specimen: "blood",
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
        specimen: "blood",
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
      expect([beat.source, beat.specimen, beat.value, beat.unit]).toEqual([
        "narrated",
        null,
        null,
        null,
      ]);
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

  test("refuses a glucose value without its specimen, and a specimen on anything else", () => {
    if (first === undefined) throw new Error("the mock day has beats");
    const glucose = kiosk.beats.find(
      (beat) => beat.measure === "glucose" && beat.source === "measured",
    );
    if (glucose === undefined) throw new Error("the mock day has glucose beats");
    const withBeat = (beat: object) => ({ ...kiosk, beats: [beat] });
    expect(
      kioskDaySchema.safeParse(withBeat({ ...glucose, specimen: null })).success,
    ).toBe(false);
    expect(
      kioskDaySchema.safeParse(withBeat({ ...first, specimen: "blood" })).success,
    ).toBe(false);
    const [window] = kiosk.worth_a_look;
    if (window === undefined) throw new Error("the mock day has a window");
    expect(
      kioskDaySchema.safeParse({
        ...kiosk,
        worth_a_look: [{ ...window, specimen: null }],
      }).success,
    ).toBe(false);
  });

  test("refuses an unknown field and another schema version", () => {
    expect(kioskDaySchema.safeParse({ ...kiosk, extra: 1 }).success).toBe(false);
    expect(
      kioskDaySchema.safeParse({ ...kiosk, schema_version: "twin-llm.kiosk-day.v2" })
        .success,
    ).toBe(false);
  });
});
