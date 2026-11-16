import { describe, expect, test } from "bun:test";

import { type DayBeat, dayBeatSchema, signalText } from "./day-beat";

const MEASURED: DayBeat = {
  time: "08:15",
  event: "Walk, glucose peak",
  source: "measured",
  signal: { measure: "glucose", direction: "up", value: 135, unit: "mg/dL" },
  body: { text: "Sugar from food passes into the blood.", organ: "bloodvasculature" },
  view: { focus: "bloodvasculature", depth: "organs" },
};

const NARRATED: DayBeat = {
  time: "08:15",
  event: "Walk, glucose peak",
  source: "narrated",
  signal: { measure: "insulin", direction: "up", value: null, unit: null },
  body: { text: "The pancreas releases insulin.", organ: "pancreas" },
  view: { focus: "pancreas", depth: "organs" },
};

describe("DayBeat types", () => {
  test("a narrated value or a measured insulin does not compile", () => {
    const narratedWithValue: DayBeat = {
      ...NARRATED,
      // @ts-expect-error a narrated signal carries no value
      signal: { ...NARRATED.signal, value: 12 },
    };
    const measuredInsulin: DayBeat = {
      ...MEASURED,
      // @ts-expect-error insulin has no measured form
      signal: { measure: "insulin", direction: "up", value: 12, unit: "mU/L" },
    };
    // @ts-expect-error a measured beat needs a value
    const measuredWithoutValue: DayBeat = { ...MEASURED, signal: NARRATED.signal };
    expect([narratedWithValue, measuredInsulin, measuredWithoutValue].length).toBe(3);
  });
});

describe("dayBeatSchema", () => {
  test("accepts a measured glucose and a narrated insulin", () => {
    expect(dayBeatSchema.parse(MEASURED)).toEqual(MEASURED);
    expect(dayBeatSchema.parse(NARRATED)).toEqual(NARRATED);
  });

  test("refuses a narrated beat with a value, with or without a unit", () => {
    for (const unit of [null, "mU/L", "mg/dL"]) {
      const result = dayBeatSchema.safeParse({
        ...NARRATED,
        signal: { measure: "glucose", direction: "up", value: 12, unit },
      });
      expect(result.success).toBe(false);
    }
  });

  test("refuses insulin as measured or derived", () => {
    for (const source of ["measured", "derived"] as const) {
      const result = dayBeatSchema.safeParse({
        ...MEASURED,
        source,
        signal: { measure: "insulin", direction: "up", value: 12, unit: "mU/L" },
      });
      expect(result.success).toBe(false);
    }
  });

  test("refuses a unit that does not belong to the measure", () => {
    const result = dayBeatSchema.safeParse({
      ...MEASURED,
      signal: { measure: "glucose", direction: "up", value: 135, unit: "/min" },
    });
    expect(result.success).toBe(false);
  });

  test("refuses a seventh field and a bad time", () => {
    expect(dayBeatSchema.safeParse({ ...MEASURED, note: "extra" }).success).toBe(false);
    expect(dayBeatSchema.safeParse({ ...MEASURED, time: "8:15" }).success).toBe(false);
  });
});

describe("signalText", () => {
  test("a measured value is shown with its unit and source", () => {
    expect(signalText(MEASURED)).toBe("Blood glucose up · about 135 mg/dL · measured");
  });

  test("a narrated beat never shows a number", () => {
    expect(signalText(NARRATED)).toBe("Insulin up · narrated, not measured");
  });
});
