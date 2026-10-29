import { describe, expect, test } from "bun:test";

import {
  formatBytes,
  formatDate,
  formatForPrompt,
  formatMeasure,
  formatMeasureCompact,
  formatMeasureNumber,
  formatMetricValue,
  formatNumber,
  formatRelative,
  formatUnit,
  isMainSleepKey,
  isoLocalDate,
  measureKindFor,
  metricLabel,
  metricStem,
  propertyLabel,
  roundTo,
  type MeasureKind,
} from "./format-measure";

// Synthetic values only.

describe("formatNumber", () => {
  const cases: readonly [number | null | undefined, number, string][] = [
    [0.15, 1, "0.2"],
    [0.25, 1, "0.3"],
    [1.005, 2, "1.01"],
    [2.25, 1, "2.3"],
    [-1.25, 1, "-1.3"],
    [-0.04, 1, "0.0"],
    [-0, 0, "0"],
    [12345.678, 1, "12,345.7"],
    [1234567, 0, "1,234,567"],
    [7, 2, "7.00"],
    [1e-7, 2, "0.00"],
    [null, 1, "—"],
    [undefined, 1, "—"],
    [Number.NaN, 1, "—"],
    [Number.POSITIVE_INFINITY, 0, "—"],
    [Number.NEGATIVE_INFINITY, 0, "—"],
  ];
  test.each(cases)("%p at %p dp → %p", (value, decimals, expected) => {
    expect(formatNumber(value, decimals)).toBe(expected);
  });
});

describe("roundTo", () => {
  test.each([
    [0.15, 1, 0.2],
    [1.005, 2, 1.01],
    [-2.5, 0, -3],
    [-0.04, 1, 0],
    [123.456, 1, 123.5],
  ] as const)("%p at %p dp → %p", (value, decimals, expected) => {
    expect(roundTo(value, decimals)).toBe(expected);
  });

  test("returns huge values unchanged", () => {
    expect(roundTo(1e21, 1)).toBe(1e21);
    expect(roundTo(-2.5e22, 0)).toBe(-2.5e22);
  });

  test("never returns negative zero", () => {
    expect(Object.is(roundTo(-0.04, 1), 0)).toBe(true);
  });
});

describe("formatMeasure", () => {
  const cases: readonly [MeasureKind, number, string, string][] = [
    // kind, value, expected, expected for -value
    ["hrv", 43.5, "44 ms", "-44 ms"],
    ["heartRate", 52.49, "52 bpm", "-52 bpm"],
    ["spo2", 96.25, "96.3%", "-96.3%"],
    ["percent", 87.5, "88%", "-88%"],
    ["score", 78.99, "79", "-79"],
    ["sleepMinutes", 452, "7 h 32 min", "-7 h 32 min"],
    ["steps", 12345, "12,345", "-12,345"],
    ["kcal", 412.5, "413 kcal", "-413 kcal"],
    ["strain", 12.35, "12.4", "-12.4"],
    ["lengthCm", 172.45, "172.5 cm", "-172.5 cm"],
    ["angle", 12.25, "12.3°", "-12.3°"],
    ["massKg", 70.05, "70.1 kg", "-70.1 kg"],
    ["bmi", 22.85, "22.9", "-22.9"],
    ["tokensPerSecond", 41.25, "41.3 tok/s", "-41.3 tok/s"],
    ["ms", 812.5, "813 ms", "-813 ms"],
    ["costUsd", 0, "$0.0000", "$0.0000"],
  ];

  test.each(cases)("%s %p → %p", (kind, value, expected, negative) => {
    expect(formatMeasure(kind, value)).toBe(expected);
    expect(formatMeasure(kind, -value)).toBe(negative);
  });

  test.each(cases.map(([kind]) => kind))(
    "%s renders missing values as a dash",
    (kind) => {
      expect(formatMeasure(kind, null)).toBe("—");
      expect(formatMeasure(kind, Number.NaN)).toBe("—");
      expect(formatMeasure(kind, undefined)).toBe("—");
    },
  );

  test.each([
    [0, "0 min"],
    [59, "59 min"],
    [59.5, "1 h"],
    [60, "1 h"],
    [61, "1 h 1 min"],
    [452, "7 h 32 min"],
  ] as const)("sleep minutes %p → %p", (value, expected) => {
    expect(formatMeasure("sleepMinutes", value)).toBe(expected);
  });

  test("cost keeps the sign before the currency", () => {
    expect(formatMeasure("costUsd", -0.00125)).toBe("-$0.0013");
    expect(formatMeasure("costUsd", 0.00004)).toBe("$0.0000");
  });

  test("formatMeasureCompact shrinks five digits to thousands for a ring", () => {
    expect(formatMeasureCompact("steps", 11_201)).toBe("11.2K");
    expect(formatMeasureCompact("steps", 12_000)).toBe("12K");
    expect(formatMeasureCompact("steps", 9800)).toBe("9,800");
    expect(formatMeasureCompact("heartRate", 58)).toBe("58");
    expect(formatMeasureCompact("steps", null)).toBe("—");
    expect(formatMeasureCompact("steps", 999_949)).toBe("999.9K");
    expect(formatMeasureCompact("steps", 999_950)).toBe("1M");
    expect(formatMeasureCompact("steps", 1_250_000)).toBe("1.3M");
  });

  test("formatMeasureNumber drops the unit", () => {
    expect(formatMeasureNumber("strain", 12.35)).toBe("12.4");
    expect(formatMeasureNumber("steps", 8412)).toBe("8,412");
    expect(formatMeasureNumber("heartRate", null)).toBe("—");
  });
});

describe("formatBytes", () => {
  test("whole bytes below a kilobyte, then one decimal in decimal units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1000)).toBe("1.0 kB");
    expect(formatBytes(4_911_581)).toBe("4.9 MB");
    expect(formatBytes(5_225_387_652)).toBe("5.2 GB");
    expect(formatBytes(2_500_000_000_000_000)).toBe("2,500.0 TB");
  });
  test("a value that rounds up to 1,000 moves to the next unit", () => {
    expect(formatBytes(999_960)).toBe("1.0 MB");
  });
  test("missing or negative sizes show as a dash", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(Number.NaN)).toBe("—");
    expect(formatBytes(-1)).toBe("—");
  });
});

describe("isoLocalDate", () => {
  test("uses the local calendar day, not UTC", () => {
    // 23:59 local on 16 Oct is the 16th here, whatever UTC says.
    expect(isoLocalDate(new Date(2026, 9, 16, 23, 59, 59))).toBe("2026-10-16");
    // 00:01 local on 17 Oct is the 17th, even where UTC is still the 16th.
    expect(isoLocalDate(new Date(2026, 9, 17, 0, 1))).toBe("2026-10-17");
  });

  test("pads month and day", () => {
    expect(isoLocalDate(new Date(2026, 0, 5, 12))).toBe("2026-01-05");
  });
});

describe("formatDate", () => {
  test.each([
    ["2026-10-16", "long", "16 Oct 2026"],
    ["2026-10-16", "short", "16 Oct"],
    ["2026-01-01", "long", "1 Jan 2026"],
    ["2026-02-31", "long", "—"],
    ["16.10.2026", "long", "—"],
    ["", "long", "—"],
  ] as const)("%p (%s) → %p", (iso, style, expected) => {
    expect(formatDate(iso, style)).toBe(expected);
  });

  test("null and undefined", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
  });
});

describe("formatRelative", () => {
  const now = Date.UTC(2026, 9, 16, 12, 0, 0);
  test.each([
    ["2026-10-16T12:00:00.000Z", "just now"],
    ["2026-10-16T11:00:01.000Z", "just now"],
    ["2026-10-16T11:00:00.000Z", "1 h ago"],
    ["2026-10-14T12:00:01.000Z", "47 h ago"],
    ["2026-10-14T12:00:00.000Z", "2 d ago"],
    ["2026-10-01T12:00:00.000Z", "15 d ago"],
    ["2026-10-16T13:00:00.000Z", "just now"],
    ["not a date", "—"],
  ] as const)("%p → %p", (iso, expected) => {
    expect(formatRelative(iso, now)).toBe(expected);
  });

  test("null", () => {
    expect(formatRelative(null, now)).toBe("—");
  });
});

describe("metricStem", () => {
  test("drops the date and Oura's sleep period, keeps everything else", () => {
    expect(metricStem("sleep.hr.long_sleep.2026-10-01")).toBe("sleep.hr");
    expect(metricStem("google.steps.2026-10-15")).toBe("google.steps");
    expect(metricStem("whoop.cycle.strain")).toBe("whoop.cycle.strain");
  });
});

describe("formatUnit", () => {
  test.each([
    ["m2", "m²"],
    ["m3", "m³"],
    ["kg/m2", "kg/m²"],
    ["deg", "°"],
    ["kg", "kg"],
    ["", ""],
  ] as const)("%p → %p", (unit, expected) => {
    expect(formatUnit(unit)).toBe(expected);
  });
});

describe("isMainSleepKey", () => {
  test.each([
    ["sleep.duration.long_sleep.2026-10-16", true],
    ["sleep.duration.2026-10-16", true],
    ["sleep.duration.rest.2026-10-16", false],
    ["sleep.hr.late_nap.2026-10-16", false],
    ["sleep.score.sleep_2.2026-10-16", false],
    ["workout.duration.running.2026-10-16", true],
    ["google.steps.2026-10-16", true],
  ] as const)("%p → %p", (key, expected) => {
    expect(isMainSleepKey(key)).toBe(expected);
  });
});

describe("propertyLabel", () => {
  test.each([
    ["body.bmi", "BMI"],
    ["body.height", "Height"],
    ["body.surface", "Body surface area"],
    ["body.volume", "Body volume"],
    ["body.mass", "Body mass"],
    ["body.other", "body.other"],
  ] as const)("%p → %p", (path, expected) => {
    expect(propertyLabel(path)).toBe(expected);
  });
});

describe("metricLabel", () => {
  test.each([
    ["sleep.hrv.2026-10-16", "Average HRV during sleep"],
    ["sleep.score.long_sleep.2026-10-16", "Sleep score"],
    ["sleep.score.late_nap.2026-10-16", "Sleep score (late nap)"],
    ["sleep.score.sleep.2026-10-16", "Sleep score (sleep)"],
    ["sleep.hrv.rest.2026-10-16", "Average HRV during sleep (rest)"],
    ["sleep.duration.rest_2.2026-10-16", "Total sleep duration (rest 2)"],
    ["readiness.score.2026-10-16", "Readiness score"],
    ["activity.active_calories.2026-10-16", "Active calories"],
    ["workout.calories.running.2026-10-16", "Workout calories (running)"],
    [
      "workout.duration.strength_training.2026-10-16",
      "Workout duration (strength training)",
    ],
    ["spo2.average.2026-10-16", "Nightly SpO2 average"],
    ["stress.high.2026-10-16", "Time in high stress"],
    ["vo2max.value.2026-10-16", "VO2 max"],
    ["whoop.recovery.hrv.2026-10-16", "Whoop HRV RMSSD"],
    ["whoop.sleep.in_bed_min.2026-10-16", "Whoop time in bed"],
    ["whoop.workout.strain.running.2026-10-16", "Whoop workout strain (running)"],
    [
      "whoop.workout.hr_zone_3.functional_fitness_2.2026-10-16",
      "Whoop time in HR zone 3 (functional fitness 2)",
    ],
    ["google.daily-heart-rate-variability.2026-10-16", "Daily HRV"],
    ["vitronic.height.knee.2026-10-16", "BodyLoop height knee"],
    [
      "vitronic.circumference.torso.waist.2026-10-16",
      "BodyLoop circumference torso waist",
    ],
    ["vitronic.angle.shoulder_tilt.2026-10-16", "BodyLoop angle shoulder_tilt"],
    ["vitronic.property.body.height.2026-10-16", "BodyLoop Height"],
    ["vitronic.property.body.bmi.2026-10-16", "BodyLoop BMI"],
    ["vitronic.property.body.other.2026-10-16", "BodyLoop body.other"],
  ] as const)("%p → %p", (key, expected) => {
    expect(metricLabel(key)).toBe(expected);
  });

  test("unknown keys use the stored label without its date", () => {
    expect(metricLabel("google.vo2.2026-10-16", "VO2 max (2026-10-16)")).toBe("VO2 max");
    expect(metricLabel("other.thing.2026-10-16")).toBe("other.thing");
  });
});

describe("measureKindFor", () => {
  test.each([
    ["sleep.duration.2026-10-16", "min", "sleepMinutes"],
    ["sleep.hr.long_sleep.2026-10-16", "bpm", "heartRate"],
    ["whoop.cycle.strain.2026-10-16", undefined, "strain"],
    ["whoop.cycle.strain.", undefined, "strain"],
    ["sleep.score.", undefined, "score"],
    ["workout.calories.running.2026-10-16", "kcal", "kcal"],
    ["workout.distance.running.2026-10-16", "m", null],
    ["whoop.workout.max_hr.running.2026-10-16", "bpm", "heartRate"],
    ["whoop.workout.strain.", undefined, "strain"],
    ["whoop.workout.kilojoules.running.2026-10-16", "kJ", null],
    ["spo2.average.2026-10-16", "%", "spo2"],
    ["stress.recovery_high.2026-10-16", "min", "sleepMinutes"],
    ["vo2max.value.2026-10-16", "mL/kg/min", null],
    ["vitronic.angle.x.2026-10-16", "deg", "angle"],
    ["vitronic.height.x.2026-10-16", "cm", "lengthCm"],
    ["vitronic.height.x.2026-10-16", "m", null],
    ["google.unknown.2026-10-16", undefined, null],
  ] as const)("%p (%p) → %p", (key, unit, expected) => {
    expect(measureKindFor(key, unit)).toBe(expected);
  });
});

describe("formatMetricValue and formatForPrompt", () => {
  test.each([
    [{ key: "sleep.hrv.2026-10-16", value: 43.886, unit: "ms" }, "44 ms"],
    [{ key: "sleep.duration.2026-10-16", value: 408, unit: "min" }, "6 h 48 min"],
    [{ key: "sleep.efficiency.2026-10-16", value: 87.74, unit: "%" }, "88%"],
    [{ key: "whoop.recovery.spo2.2026-10-16", value: 96.25, unit: "%" }, "96.3%"],
    [{ key: "vitronic.angle.x.2026-10-16", value: 12.25, unit: "deg" }, "12.3°"],
    [{ key: "vitronic.height.x.2026-10-16", value: 1.7234, unit: "m" }, "1.7 m"],
    [{ key: "google.weight.2026-10-16", value: 154.24, unit: "lb" }, "154.2 lb"],
    [{ key: "google.weight.2026-10-16", value: 70.05, unit: "kg" }, "70.1 kg"],
    [{ key: "sleep.hr.2026-10-16", value: 52.4, unit: "" }, "52 bpm"],
    [{ key: "whoop.recovery.score.2026-10-16", value: 78.6, unit: "%" }, "79%"],
    [{ key: "vitronic.angle.x.2026-10-16", value: 12.25, unit: "°" }, "12.3°"],
    [{ key: "google.unknown.2026-10-16", value: 3, unit: "" }, "3"],
    [{ key: "google.unknown.2026-10-16", value: "high", unit: "" }, "high"],
    [{ key: "google.unknown.2026-10-16", value: Number.NaN }, "—"],
    [
      { key: "sleep.duration.long_sleep.2026-10-16", value: 432, unit: "min" },
      "7 h 12 min",
    ],
    [{ key: "sleep.duration.rest.2026-10-16", value: 2, unit: "min" }, "2 min"],
    [
      { key: "vitronic.property.body.bmi.2026-10-16", value: 23.46, unit: "kg/m2" },
      "23.5 kg/m²",
    ],
    [
      { key: "vitronic.property.body.surface.2026-10-16", value: 1.85, unit: "m2" },
      "1.9 m²",
    ],
    [
      { key: "vitronic.property.body.volume.2026-10-16", value: "0.065", unit: "m3" },
      "0.065 m³",
    ],
    [{ key: "google.unknown.2026-10-16", value: Number.NaN, unit: "m2" }, "—"],
  ] as const)("%o → %p", (metric, expected) => {
    expect(formatMetricValue(metric)).toBe(expected);
  });

  test("prompt line keeps the citation key and ISO date", () => {
    expect(
      formatForPrompt({
        key: "sleep.hrv.2026-10-16",
        label: "Average HRV during sleep (2026-10-16)",
        value: 43.886,
        unit: "ms",
        date: "2026-10-16",
      }),
    ).toBe("[sleep.hrv.2026-10-16] Average HRV during sleep (2026-10-16): 44 ms");
  });
});
