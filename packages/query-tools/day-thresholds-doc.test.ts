import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { signalText } from "./day-beat";
import {
  DAY_RULES,
  DAY_THRESHOLDS,
  type DayReading,
  dayBeats,
  GLUCOSE_PROFILES,
  redWindows,
} from "./day-beats";
import MOCK_DAY from "./fixtures/mock-day.json";

/** The review page for Robin must hold every threshold and every sentence on screen. */
const DOC = readFileSync(
  fileURLToPath(new URL("../../docs/day-thresholds.md", import.meta.url)),
  "utf8",
);

const reading = (
  time: string,
  heartRatePerMin: number | null,
  glucoseMgDl: number | null,
  moving: boolean | null,
): DayReading => ({ time, event: null, heartRatePerMin, glucoseMgDl, moving });

/** The mock day plus readings that reach every direction and every window. */
const READINGS: readonly DayReading[] = [
  ...MOCK_DAY.readings.map((one) => ({
    time: one.time,
    event: one.event,
    heartRatePerMin: one.heart_rate_per_min,
    glucoseMgDl: one.glucose_mg_dl,
    moving: one.moving,
  })),
  reading("23:00", 110, 60, false),
  reading("23:10", 111, 61, false),
  reading("23:20", 70, 100, false),
  reading("23:30", 70, 200, false),
];

const sensor = (time: string, sensorGlucoseMgDl: number): DayReading => ({
  ...reading(time, null, null, null),
  sensorGlucoseMgDl,
});

/** Sensor readings that reach every direction and every sensor window. */
const SENSOR_READINGS: readonly DayReading[] = [
  sensor("01:00", 100),
  sensor("01:05", 130),
  sensor("01:10", 100),
  sensor("01:15", 101),
  sensor("01:20", 60),
  sensor("01:25", 200),
];

/** A table row naming a key and its value, whatever the column padding. */
const row = (key: string, value: string): RegExp =>
  new RegExp(String.raw`\|\s*\x60${key}\x60\s*\|\s*${value}\s*\|`);

describe("docs/day-thresholds.md", () => {
  test("names every threshold key and value", () => {
    const [low, high] = DAY_THRESHOLDS.glucoseWithDiabetesRangeMgDl;
    expect(DOC).toContain(
      `Status \`${DAY_THRESHOLDS.status}\`, reviewer ${DAY_THRESHOLDS.reviewer}`,
    );
    expect(DOC).toMatch(
      row(
        "heartRateStillAbovePerMin",
        `${DAY_THRESHOLDS.heartRateStillAbovePerMin} /min`,
      ),
    );
    expect(DOC).toMatch(
      row(
        "glucoseWithoutDiabetesAboveMgDl",
        `${DAY_THRESHOLDS.glucoseWithoutDiabetesAboveMgDl} mg/dL`,
      ),
    );
    expect(DOC).toMatch(row("glucoseWithDiabetesRangeMgDl", `${low}–${high} mg/dL`));
    expect(DOC).toMatch(
      row("recoveryWithinPerMin", `${DAY_THRESHOLDS.recoveryWithinPerMin} /min`),
    );
  });

  test("states every rule in code at its value", () => {
    const { scale, steady, insulinRise } = DAY_RULES;
    expect(DOC).toContain(
      `| ${scale.heart_rate} /min of heart rate = ${scale.glucose} mg/dL of glucose `,
    );
    expect(DOC).toContain(`| change under ${steady.heart_rate} /min `);
    expect(DOC).toContain(`| change under ${steady.glucose} mg/dL `);
    expect(DOC).toContain(
      `| glucose rise of ${insulinRise} mg/dL or more since the reading before `,
    );
  });

  test("holds every body sentence, window rule and event the beats can show", () => {
    const all = [...READINGS, ...SENSOR_READINGS];
    const beats = GLUCOSE_PROFILES.flatMap((profile) => dayBeats(all, profile));
    const windows = GLUCOSE_PROFILES.flatMap((profile) => redWindows(all, profile));
    const texts = new Set(beats.map((beat) => beat.body.text));
    // Ten sentences and seven window texts: each direction of the three signals,
    // insulin, the heart-rate window, and each glucose window for blood and sensor.
    expect(texts.size).toBe(17);
    for (const text of texts) expect(DOC).toContain(text);
    for (const window of windows) expect(DOC).toContain(window.rule);
    expect(new Set(windows.map((window) => window.rule)).size).toBe(5);
    const events = new Set(
      beats.filter((beat) => beat.source === "derived").map((beat) => beat.event),
    );
    for (const event of events) expect(DOC).toContain(`the event reads \`${event}\``);
  });

  test("shows a value line of each kind as signalText writes it", () => {
    const beats = dayBeats(READINGS, "without_diabetes");
    const walk = beats.find(
      (beat) => beat.time === "08:15" && beat.source === "measured",
    );
    const insulin = beats.find((beat) => beat.signal.measure === "insulin");
    expect(walk && signalText(walk)).toBe(
      "Blood glucose up · about 135 mg/dL · measured",
    );
    expect(DOC).toContain(`\`${walk && signalText(walk)}\``);
    const rise = dayBeats(SENSOR_READINGS, "without_diabetes")[1];
    expect(rise && signalText(rise)).toBe(
      "Sensor glucose up · about 130 mg/dL · measured",
    );
    expect(DOC).toContain(`\`${rise && signalText(rise)}\``);
    expect(insulin && signalText(insulin)).toBe("Insulin up · narrated, not measured");
    expect(DOC).toContain(`\`${insulin && signalText(insulin)}\``);
  });
});
