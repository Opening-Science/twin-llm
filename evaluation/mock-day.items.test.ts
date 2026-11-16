/**
 * Checks for the mock-day item set (`mock-day.items.v1.json`): it parses, and
 * every expected value is what `dayBeats` and `redWindows` give for the
 * illustrative mock day under the item's profile. Offline: the fixture is
 * read, nothing else.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  type DayReading,
  dayBeats,
  type GlucoseProfile,
  redWindows,
} from "../packages/query-tools/day-beats";
import MOCK_DAY from "../packages/query-tools/fixtures/mock-day.json";
import { mockDayItemSetSchema } from "../scripts/evaluation/mock-day-items";
import { readPath } from "../scripts/evaluation/question-set";

const set = mockDayItemSetSchema.parse(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL("./mock-day.items.v1.json", import.meta.url)),
      "utf8",
    ),
  ) as unknown,
);

const READINGS: readonly DayReading[] = MOCK_DAY.readings.map((one) => ({
  time: one.time,
  event: one.event,
  heartRatePerMin: one.heart_rate_per_min,
  glucoseMgDl: one.glucose_mg_dl,
  moving: one.moving,
}));

const dayAs = (profile: GlucoseProfile) => ({
  beats: dayBeats(READINGS, profile),
  red_windows: redWindows(READINGS, profile),
});

describe("mock-day item set", () => {
  test("has six items over both profiles, on the labelled mock day", () => {
    expect(MOCK_DAY.label).toBe("illustrative mock");
    expect(set.items.map((item) => item.id)).toEqual([
      "D-01",
      "D-02",
      "D-03",
      "D-04",
      "D-05",
      "D-06",
    ]);
    expect(new Set(set.items.map((item) => item.profile))).toEqual(
      new Set(["without_diabetes", "with_diabetes"]),
    );
  });

  test("every expected value is what show_my_day's beats give for the mock day", () => {
    const rows = set.items.flatMap((item) =>
      item.expect.values.map((spec) => {
        const actual = readPath(dayAs(item.profile), spec.path);
        // A path that does not resolve reads as "missing", never as null.
        return {
          id: item.id,
          name: spec.name,
          expected: spec.value,
          actual: actual === undefined ? "missing" : actual,
        };
      }),
    );
    expect(rows.length).toBe(15);
    expect(rows.map((row) => [row.id, row.name, row.actual])).toEqual(
      rows.map((row) => [row.id, row.name, row.expected]),
    );
  });

  test("an insulin value is always expected as null: insulin is narrated, never measured", () => {
    const insulinValues = set.items.flatMap((item) =>
      item.expect.values.filter((spec) => {
        const beat = /^beats\.(\d+)\.signal\.value$/.exec(spec.path)?.[1];
        return (
          beat !== undefined &&
          readPath(dayAs(item.profile), `beats.${beat}.signal.measure`) === "insulin"
        );
      }),
    );
    expect(insulinValues.map((spec) => spec.value)).toEqual([null]);
  });
});
