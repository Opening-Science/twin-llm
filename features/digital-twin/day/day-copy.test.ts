import { describe, expect, test } from "bun:test";

import { myDayOption, worthALookLine } from "./day-copy";

describe("worthALookLine", () => {
  test("one reading is one time; the value is as given", () => {
    expect(
      worthALookLine({
        from: "20:30",
        to: "20:30",
        measure: "glucose",
        extreme: 175,
        unit: "mg/dL",
      }),
    ).toBe("20:30 · Glucose · furthest 175 mg/dL");
  });

  test("the value is rounded as the beat lines round it", () => {
    expect(
      worthALookLine({
        from: "20:30",
        to: "20:30",
        measure: "glucose",
        extreme: 155.4,
        unit: "mg/dL",
      }),
    ).toBe("20:30 · Glucose · furthest 155 mg/dL");
  });

  test("a stretch names both ends", () => {
    expect(
      worthALookLine({
        from: "10:30",
        to: "11:15",
        measure: "heart_rate",
        extreme: 112,
        unit: "/min",
      }),
    ).toBe("10:30 to 11:15 · Heart rate · furthest 112 /min");
  });
});

describe("myDayOption", () => {
  test("counts readings in words", () => {
    expect(myDayOption("2026-11-16", 1)).toBe("16 Nov 2026 · 1 reading");
    expect(myDayOption("2026-11-16", 26)).toBe("16 Nov 2026 · 26 readings");
  });
});
