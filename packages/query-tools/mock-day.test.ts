import { describe, expect, test } from "bun:test";

import MOCK_DAY from "./fixtures/mock-day.json";
import { MOCK_DAY_DATE, mockDayReadings } from "./mock-day";

describe("the mock day fixture's sensor series", () => {
  test("is labelled illustrative and says it trails the blood", () => {
    expect(MOCK_DAY.label).toBe("illustrative mock");
    expect(MOCK_DAY.sensor_note).toBe(
      "Sensor glucose is an illustrative continuous monitor reading at the same moments, made to trail the blood values by about ten minutes: lower on a rise, higher on a fall.",
    );
    expect(MOCK_DAY_DATE).toBe("2026-11-16");
  });

  test("reads lower than blood after each rise and higher after each fall", () => {
    const readings = mockDayReadings("both");
    const moves = readings.slice(1).map((reading, index) => {
      const before = readings[index]?.glucoseMgDl ?? 0;
      const blood = reading.glucoseMgDl ?? 0;
      const sensor = reading.sensorGlucoseMgDl ?? 0;
      return [reading.time, Math.sign(blood - before), Math.sign(sensor - blood)];
    });
    // The blood rises of 20 mg/dL or more, and the falls of 20 or more.
    const at = (times: readonly string[]) =>
      moves.filter(([time]) => times.includes(String(time)));
    expect(at(["08:15", "13:00", "20:30"])).toEqual([
      ["08:15", 1, -1],
      ["13:00", 1, -1],
      ["20:30", 1, -1],
    ]);
    expect(at(["10:00", "18:00"])).toEqual([
      ["10:00", -1, 1],
      ["18:00", -1, 1],
    ]);
  });
});

describe("mockDayReadings", () => {
  test("blood: heart rate and blood glucose, the day as first written", () => {
    expect(mockDayReadings("blood")[3]).toEqual({
      time: "08:15",
      event: "Walk, glucose peak",
      heartRatePerMin: 95,
      glucoseMgDl: 135,
      moving: true,
    });
  });

  test("sensor: no blood glucose at all, only the sensor", () => {
    const readings = mockDayReadings("sensor");
    expect(readings[3]).toEqual({
      time: "08:15",
      event: "Walk, glucose peak",
      heartRatePerMin: 95,
      glucoseMgDl: null,
      sensorGlucoseMgDl: 117,
      moving: true,
    });
    expect(readings.every((reading) => reading.glucoseMgDl === null)).toBe(true);
  });

  test("both: each reading carries the sensor value next to blood", () => {
    const readings = mockDayReadings("both");
    expect(readings).toHaveLength(14);
    expect(readings[3]).toEqual({
      time: "08:15",
      event: "Walk, glucose peak",
      heartRatePerMin: 95,
      glucoseMgDl: 135,
      sensorGlucoseMgDl: 117,
      moving: true,
    });
    expect(readings.map((reading) => reading.sensorGlucoseMgDl)).toEqual([
      86, 93, 95, 117, 97, 96, 99, 108, 107, 92, 88, 98, 152, 112,
    ]);
  });
});
