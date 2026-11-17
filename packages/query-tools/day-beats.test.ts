import { describe, expect, test } from "bun:test";

import { dayBeatSchema } from "./day-beat";
import { DAY_THRESHOLDS, type DayReading, dayBeats, redWindows } from "./day-beats";
import MOCK_DAY from "./fixtures/mock-day.json";

/** The illustrative mock day: hand-written values, not a recording of anyone. */
const READINGS: readonly DayReading[] = MOCK_DAY.readings.map((reading) => ({
  time: reading.time,
  event: reading.event,
  heartRatePerMin: reading.heart_rate_per_min,
  glucoseMgDl: reading.glucose_mg_dl,
  moving: reading.moving,
}));

const reading = (
  time: string,
  heartRatePerMin: number | null,
  glucoseMgDl: number | null,
  moving: boolean | null = false,
): DayReading => ({ time, event: null, heartRatePerMin, glucoseMgDl, moving });

describe("the mock day fixture", () => {
  test("is labelled illustrative mock and has 14 readings", () => {
    expect(MOCK_DAY.label).toBe("illustrative mock");
    expect(READINGS.length).toBe(14);
  });
});

describe("DAY_THRESHOLDS", () => {
  test("are placeholders for Robin", () => {
    expect(DAY_THRESHOLDS).toEqual({
      status: "placeholder",
      reviewer: "Robin",
      note: "Placeholder thresholds for red windows and recovery after workouts, to be confirmed by Robin. Not clinical guidance.",
      heartRateStillAbovePerMin: 100,
      glucoseWithoutDiabetesAboveMgDl: 140,
      glucoseWithDiabetesRangeMgDl: [70, 180],
      recoveryWithinPerMin: 10,
    });
  });
});

describe("dayBeats on the mock day", () => {
  const beats = dayBeats(READINGS, "without_diabetes");

  test("one beat per reading, insulin after each rise of 20 mg/dL or more, one red window", () => {
    // Hand-checked: each reading's change over its scale (20 /min, 15 mg/dL) picks the signal.
    expect(
      beats.map((beat) => [
        beat.time,
        beat.source,
        beat.signal.measure,
        beat.signal.direction,
        beat.signal.value,
        beat.body.organ,
      ]),
    ).toEqual([
      ["03:00", "measured", "heart_rate", "steady", 52, "heart"],
      ["06:30", "measured", "heart_rate", "up", 70, "heart"],
      ["07:30", "measured", "heart_rate", "down", 64, "heart"],
      ["08:15", "measured", "glucose", "up", 135, "bloodvasculature"],
      ["08:15", "narrated", "insulin", "up", null, "pancreas"],
      ["10:00", "measured", "glucose", "down", 92, "liver"],
      ["10:30", "measured", "heart_rate", "up", 88, "heart"],
      ["12:30", "measured", "heart_rate", "down", 68, "heart"],
      ["13:00", "measured", "heart_rate", "up", 100, "heart"],
      ["13:00", "narrated", "insulin", "up", null, "pancreas"],
      ["15:30", "measured", "heart_rate", "down", 68, "heart"],
      ["18:00", "measured", "heart_rate", "up", 160, "heart"],
      ["18:45", "measured", "heart_rate", "down", 85, "heart"],
      ["19:30", "measured", "glucose", "up", 100, "bloodvasculature"],
      ["20:30", "measured", "glucose", "up", 175, "bloodvasculature"],
      ["20:30", "narrated", "insulin", "up", null, "pancreas"],
      ["20:30", "derived", "glucose", "up", 175, "bloodvasculature"],
      ["22:30", "measured", "glucose", "down", 105, "liver"],
    ]);
  });

  test("every beat parses, and every insulin beat is narrated", () => {
    expect(beats.every((beat) => dayBeatSchema.safeParse(beat).success)).toBe(true);
    expect(
      beats
        .filter((beat) => beat.signal.measure === "insulin")
        .map((beat) => [beat.source, beat.signal.value]),
    ).toEqual([
      ["narrated", null],
      ["narrated", null],
      ["narrated", null],
    ]);
  });

  test("the run beat keeps its event and opens the heart at the Organs depth", () => {
    expect(beats[11]).toEqual({
      time: "18:00",
      event: "Run",
      source: "measured",
      signal: { measure: "heart_rate", direction: "up", value: 160, unit: "/min" },
      body: {
        text: "The heart beats faster to move more blood to working muscles.",
        organ: "heart",
      },
      view: { focus: "heart", depth: "organs" },
    });
  });
});

describe("redWindows", () => {
  test("without diabetes: 175 mg/dL after dinner is the only window", () => {
    expect(redWindows(READINGS, "without_diabetes")).toEqual([
      {
        from: "20:30",
        to: "20:30",
        measure: "glucose",
        specimen: "blood",
        extreme: 175,
        side: "above",
        rule: "Blood glucose above 140 mg/dL (placeholder, without diabetes)",
        thresholds: "placeholder",
      },
    ]);
  });

  test("with diabetes: the whole day stays inside 70–180 mg/dL", () => {
    expect(redWindows(READINGS, "with_diabetes")).toEqual([]);
  });

  test("the run at 160 /min is not a window: the heart-rate rule counts only while still", () => {
    expect(redWindows([reading("18:00", 160, null, true)], "without_diabetes")).toEqual(
      [],
    );
  });

  test("a fast heart while still is a window; unknown activity is not judged", () => {
    expect(
      redWindows(
        [
          reading("10:00", 104, null),
          reading("10:05", 110, null),
          reading("10:10", 90, null),
        ],
        "without_diabetes",
      ),
    ).toEqual([
      {
        from: "10:00",
        to: "10:05",
        measure: "heart_rate",
        specimen: null,
        extreme: 110,
        side: "above",
        rule: "Heart rate above 100 /min while still (placeholder)",
        thresholds: "placeholder",
      },
    ]);
    expect(redWindows([reading("10:00", 120, null, null)], "without_diabetes")).toEqual(
      [],
    );
  });

  test("with diabetes, a low reading opens a window at its lowest value", () => {
    expect(
      redWindows([reading("02:00", 55, 66), reading("02:30", 55, 62)], "with_diabetes"),
    ).toEqual([
      {
        from: "02:00",
        to: "02:30",
        measure: "glucose",
        specimen: "blood",
        extreme: 62,
        side: "below",
        rule: "Blood glucose outside 70–180 mg/dL (placeholder consensus range, with diabetes)",
        thresholds: "placeholder",
      },
    ]);
  });

  test("with diabetes, low then high in a row is two windows, one each side", () => {
    const windows = redWindows(
      [reading("02:00", 55, 60), reading("02:30", 55, 200)],
      "with_diabetes",
    );
    expect(windows.map((window) => [window.from, window.side, window.extreme])).toEqual([
      ["02:00", "below", 60],
      ["02:30", "above", 200],
    ]);
  });

  test("a low window's beat goes down and says below the range", () => {
    const low = dayBeats(
      [reading("02:00", 55, 66), reading("02:30", 55, 62)],
      "with_diabetes",
    ).find((beat) => beat.source === "derived");
    expect(low?.signal).toEqual({
      measure: "glucose",
      specimen: "blood",
      direction: "down",
      value: 62,
      unit: "mg/dL",
    });
    expect(low?.body.text).toBe(
      "Blood sugar stays below the range for a while. Blood glucose outside 70–180 mg/dL (placeholder consensus range, with diabetes).",
    );
  });
});

describe("sensor glucose", () => {
  const sensor = (
    time: string,
    sensorGlucoseMgDl: number,
    glucoseMgDl: number | null = null,
  ): DayReading => ({
    time,
    event: null,
    heartRatePerMin: null,
    glucoseMgDl,
    sensorGlucoseMgDl,
    moving: null,
  });

  test("a sensor reading is a sensor beat, and its sentence notes the lag", () => {
    const beats = dayBeats(
      [sensor("07:00", 95), sensor("07:05", 112)],
      "without_diabetes",
    );
    expect(beats[1]).toEqual({
      time: "07:05",
      event: "Reading",
      source: "measured",
      signal: {
        measure: "glucose",
        specimen: "sensor",
        direction: "up",
        value: 112,
        unit: "mg/dL",
      },
      body: {
        text: "Sugar from food passes into the blood and on into the fluid between cells. The sensor reads the fluid between cells, several minutes behind the blood.",
        organ: "bloodvasculature",
      },
      view: { focus: "bloodvasculature", depth: "organs" },
    });
  });

  test("a sensor change is taken against the sensor before, never against blood", () => {
    // Blood 135 then sensor 110: mixed, that would read as a fall of 25.
    const beats = dayBeats(
      [sensor("07:00", 108, 135), sensor("07:05", 110)],
      "without_diabetes",
    );
    expect(beats.map((beat) => [beat.time, beat.signal])).toEqual([
      [
        "07:00",
        {
          measure: "glucose",
          specimen: "blood",
          direction: "steady",
          value: 135,
          unit: "mg/dL",
        },
      ],
      [
        "07:05",
        {
          measure: "glucose",
          specimen: "sensor",
          direction: "steady",
          value: 110,
          unit: "mg/dL",
        },
      ],
    ]);
  });

  test("a sensor change skips the heart-rate minutes between sensor readings", () => {
    const minute = (time: string, sensorGlucoseMgDl: number | null): DayReading => ({
      time,
      event: null,
      heartRatePerMin: 62,
      glucoseMgDl: null,
      sensorGlucoseMgDl,
      moving: null,
    });
    const readings = [
      minute("07:00", 95),
      minute("07:01", null),
      minute("07:02", null),
      minute("07:03", null),
      minute("07:04", null),
      minute("07:05", 125),
    ];
    const at0705 = dayBeats(readings, "without_diabetes").filter(
      (beat) => beat.time === "07:05",
    );
    expect(at0705.map((beat) => [beat.source, beat.signal.measure])).toEqual([
      ["measured", "glucose"],
      ["narrated", "insulin"],
    ]);
    expect(at0705[0]?.signal).toEqual({
      measure: "glucose",
      specimen: "sensor",
      direction: "up",
      value: 125,
      unit: "mg/dL",
    });
  });

  test("a sensor rise of 20 mg/dL adds the narrated insulin beat", () => {
    const beats = dayBeats(
      [sensor("07:00", 95), sensor("07:15", 120)],
      "without_diabetes",
    );
    expect(beats.map((beat) => [beat.time, beat.source, beat.signal.measure])).toEqual([
      ["07:00", "measured", "glucose"],
      ["07:15", "measured", "glucose"],
      ["07:15", "narrated", "insulin"],
    ]);
  });

  test("sensor windows are their own, named sensor, and a blood reading between does not split one", () => {
    const readings = [
      sensor("20:00", 150),
      { ...reading("20:02", null, 120), sensorGlucoseMgDl: null },
      sensor("20:05", 165),
      sensor("20:10", 130),
    ];
    expect(redWindows(readings, "without_diabetes")).toEqual([
      {
        from: "20:00",
        to: "20:05",
        measure: "glucose",
        specimen: "sensor",
        extreme: 165,
        side: "above",
        rule: "Sensor glucose above 140 mg/dL (placeholder, without diabetes)",
        thresholds: "placeholder",
      },
    ]);
    const derived = dayBeats(readings, "without_diabetes").find(
      (beat) => beat.source === "derived",
    );
    expect(derived?.body.text).toBe(
      "Sensor glucose stays past the threshold for a while. Sensor glucose above 140 mg/dL (placeholder, without diabetes).",
    );
    expect(derived && dayBeatSchema.parse(derived)).toEqual(derived);
  });
});
