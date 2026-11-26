import { expect, test } from "bun:test";

import { SAMPLE_CHARTS, SAMPLE_CURSOR_MINUTE } from "./your-day-chart-samples";

const [heart, glucose] = SAMPLE_CHARTS;
const valueAt = (minute: number) =>
  glucose.readings.find((reading) => reading.minute === minute)?.value;

test("the samples are heart rate and sensor glucose from the synthetic demo day", () => {
  expect(heart.label).toBe("Heart rate");
  expect(heart.unit).toBe("bpm");
  expect(glucose.label).toBe("Sensor glucose");
  expect(glucose.unit).toBe("mg/dL");
  expect(heart.readings).toHaveLength(96);
  expect(glucose.readings).toHaveLength(96);
  for (const { readings } of SAMPLE_CHARTS) {
    expect(readings.every(({ minute }) => minute >= 0 && minute < 1440)).toBe(true);
  }
});

test("glucose rises after breakfast and the cursor sits on that rise", () => {
  const before = valueAt(7 * 60 + 30)!;
  const peak = valueAt(SAMPLE_CURSOR_MINUTE)!;
  expect(peak - before).toBeGreaterThan(25);
  const values = glucose.readings.map(({ value }) => value);
  expect(Math.min(...values)).toBeGreaterThanOrEqual(70);
  expect(Math.max(...values)).toBeLessThanOrEqual(180);
});
