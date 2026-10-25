import { describe, expect, test } from "bun:test";

import {
  presentMeasure,
  presentSummaryMetric,
  UNIT_CM,
  UNIT_DEG,
  UNIT_M,
  UNIT_RAD,
} from "./present-measure";

describe("presentMeasure", () => {
  test("shows a stored 1.75 m height as 175 cm", () => {
    expect(presentMeasure({ kind: "height", value: 1.75, unit: UNIT_M })).toEqual({
      value: 175,
      unit: UNIT_CM,
    });
  });

  test("shows a stored 1.4817 rad angle as 84.9 deg", () => {
    expect(presentMeasure({ kind: "angle", value: 1.4817, unit: UNIT_RAD })).toEqual({
      value: 84.9,
      unit: UNIT_DEG,
    });
  });

  test("passes through already-displayed cm and deg", () => {
    expect(presentMeasure({ kind: "distance", value: 42.5, unit: UNIT_CM })).toEqual({
      value: 42.5,
      unit: UNIT_CM,
    });
    expect(presentMeasure({ kind: "angle", value: 84.9, unit: UNIT_DEG })).toEqual({
      value: 84.9,
      unit: UNIT_DEG,
    });
  });
});

describe("presentSummaryMetric", () => {
  test("converts list keys and leaves property metres alone", () => {
    const listKey = ["vitronic", "height", "stature", "2026-07-10"].join(".");
    const propertyKey = ["vitronic", "property", "body.height", "2026-07-10"].join(".");
    const height = presentSummaryMetric({
      key: listKey,
      label: "BodyLoop height stature (2026-07-10)",
      value: 1.75,
      unit: UNIT_M,
    });
    expect(height.value).toBe(175);
    expect(height.unit).toBe(UNIT_CM);

    const property = presentSummaryMetric({
      key: propertyKey,
      label: "BodyLoop body.height (2026-07-10)",
      value: 1.7,
      unit: UNIT_M,
    });
    expect(property.value).toBe(1.7);
    expect(property.unit).toBe(UNIT_M);

    const again = presentSummaryMetric(height);
    expect(again.value).toBe(175);
    expect(again.unit).toBe(UNIT_CM);
  });
});
