import { describe, expect, test } from "bun:test";

import { MOCK_DAY_DATE, mockDayReadings } from "../mock-day";
import { mealOfTag, replayDayFromDayReadings } from "./from-day-readings";
import { DEMO_NOTICE } from "./replay-day";

const SOURCE = {
  subject_ref: "synthetic-mock-day",
  day: MOCK_DAY_DATE,
  time_zone: "UTC",
  device: "Illustrative mock day",
} as const;

describe("mealOfTag", () => {
  test("a tag that names a meal is that meal", () => {
    expect(mealOfTag("Breakfast")).toBe("breakfast");
    expect(mealOfTag("Large dinner")).toBe("dinner");
    expect(mealOfTag("lunch")).toBe("lunch");
  });

  test("a tag that only mentions a meal is not one", () => {
    expect(mealOfTag("Walk after lunch")).toBeNull();
    expect(mealOfTag("After dinner")).toBeNull();
    expect(mealOfTag("Run")).toBeNull();
  });

  test("a tag that says a meal did not happen is not one", () => {
    expect(mealOfTag("No lunch")).toBeNull();
    expect(mealOfTag("Skipped breakfast")).toBeNull();
    expect(mealOfTag("Missed dinner")).toBeNull();
    expect(mealOfTag("Without snack")).toBeNull();
    expect(mealOfTag("Late lunch")).toBe("lunch");
  });
});

describe("the mock day as a replay day", () => {
  const day = replayDayFromDayReadings(SOURCE, mockDayReadings("both"));

  test("every value is kept, blood and sensor as two series, nothing added", () => {
    const count = (stream: string, specimen?: string): number =>
      day.readings.filter(
        (reading) =>
          reading.stream === stream &&
          (specimen === undefined ||
            (reading.stream === "glucose" && reading.specimen === specimen)),
      ).length;
    expect(count("heart_rate")).toBe(14);
    expect(count("glucose", "blood")).toBe(14);
    expect(count("glucose", "sensor")).toBe(14);
    expect(count("steps")).toBe(0);
    expect(day.readings.every((reading) => reading.provenance === "measured")).toBe(true);
    expect(day.narrations).toEqual([]);
  });

  test("it is labelled a synthetic demonstration, on the day and on every item", () => {
    expect(day.origin).toBe("synthetic_demo");
    expect(day.notice).not.toBeNull();
    expect(
      [...day.readings, ...day.events].every((item) => item.origin === "synthetic_demo"),
    ).toBe(true);
  });

  test("its tags become entered events; four name a meal", () => {
    expect(day.events).toHaveLength(14);
    expect(day.events.every((event) => event.provenance === "entered")).toBe(true);
    expect(
      day.events.flatMap((event) =>
        event.kind === "meal" ? [[event.label, event.meal]] : [],
      ),
    ).toEqual([
      ["Breakfast", "breakfast"],
      ["Lunch", "lunch"],
      ["Snack", "snack"],
      ["Large dinner", "dinner"],
    ]);
    expect(day.events.some((event) => event.kind === "activity")).toBe(false);
  });

  test("its tags are the story's lines, said to be written for it, not entered by anyone", () => {
    expect(day.events.map((event) => event.label)).toContain("Stressful meeting");
    expect(new Set(day.events.map((event) => event.source.name))).toEqual(
      new Set(["Written for the illustrative day's story, not entered by anyone"]),
    );
  });

  test("the values are the mock day's own", () => {
    const first = day.readings.find((reading) => reading.stream === "heart_rate");
    expect(first?.at).toBe("2026-11-16T03:00:00.000Z");
    expect(first?.value).toBe(52);
  });

  test("a warehouse day is a synthetic person's, labelled a demonstration, never recorded", () => {
    const warehouse = replayDayFromDayReadings(
      { ...SOURCE, subject_ref: "synthea-person-1" },
      mockDayReadings("blood"),
    );
    expect(warehouse.origin).toBe("synthetic_demo");
    expect(warehouse.notice).toBe(DEMO_NOTICE);
    expect(
      [...warehouse.readings, ...warehouse.events].every(
        (item) => item.origin === "synthetic_demo",
      ),
    ).toBe(true);
    // @ts-expect-error a warehouse day cannot be passed in as recorded
    replayDayFromDayReadings({ ...SOURCE, origin: "recorded" }, []);
  });

  test("a warehouse day without a sensor has no sensor series", () => {
    const blood = replayDayFromDayReadings(SOURCE, mockDayReadings("blood"));
    expect(
      blood.readings.some(
        (reading) => reading.stream === "glucose" && reading.specimen === "sensor",
      ),
    ).toBe(false);
  });
});
