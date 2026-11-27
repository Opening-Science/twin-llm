import { expect, test } from "bun:test";

import { chartPresentation, chartUnitFor } from "./your-day-chart-units";

test("reuses a unit rule across measurements without changing the observation timing", () => {
  expect(chartPresentation("g/L", "An analyte", "observation")).toMatchObject({
    label: "mg/dL",
    scale: 100,
    presentation: "points",
  });
  expect(chartPresentation("mg/dL", "Another analyte", "sample")).toMatchObject({
    label: "mg/dL",
    scale: 1,
    presentation: "line",
  });
  expect(chartPresentation("{steps}", "Steps", "interval")).toMatchObject({
    label: "steps",
    axis: "count",
    presentation: "intervals",
  });
  expect(chartPresentation("{steps}/d", "Steps per day", "day").presentation).toBe(
    "daily-summary",
  );
  expect(chartPresentation("ms", "Nightly HRV", "night").presentation).toBe(
    "nightly-summary",
  );
});

test("does not convert unsupported units or infer a line from the unit alone", () => {
  expect(chartUnitFor("mmol/L", "An analyte")).toMatchObject({
    label: "mmol/L",
    scale: 1,
  });
  expect(chartPresentation("mg/dL", "An analyte", undefined).presentation).toBe("points");
  expect(chartUnitFor("/min", "Heart rate").label).toBe("bpm");
  expect(chartUnitFor("/min", "Respiratory rate").label).not.toBe("bpm");
});
