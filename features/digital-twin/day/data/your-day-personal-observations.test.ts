import { expect, test } from "bun:test";

import { buildPickerCatalog } from "../charts/your-day-picker-catalog";
import {
  connectedDayObservations,
  importedDayObservations,
} from "./your-day-personal-observations";

const day = "2026-10-27";
const zone = "Europe/Zurich";
const lab = {
  id: "lab-1",
  datasetId: "import-1",
  code: "2276-4",
  codeSystem: "http://loinc.org",
  display: "Ferritin",
  unit: "ng/mL",
  value: 45,
  effectiveAt: new Date("2026-10-26T23:30:00Z"),
  effectivePrecision: "instant",
} as const;

test("discovers an Anchor chart by measurement identity without a replay stream", () => {
  const rows = importedDayObservations([lab], day, zone);
  const { entries, charts } = buildPickerCatalog([], undefined, rows);
  expect(charts).toHaveLength(1);
  expect(charts[0]).toMatchObject({
    selector: null,
    marker: { id: "BM-107" },
    view: { presentation: "points" },
  });
  expect(entries.filter(({ label }) => label === "Ferritin")).toEqual([
    expect.objectContaining({ chartId: charts[0]?.id }),
  ]);
});

test("preserves date-only readings as summaries and excludes month precision", () => {
  const effectiveAt = new Date(`${day}T00:00:00Z`);
  const rows = importedDayObservations(
    [
      { ...lab, effectiveAt, effectivePrecision: "day" },
      { ...lab, effectiveAt, effectivePrecision: "month" },
    ],
    day,
    "America/New_York",
  );
  expect(rows).toEqual([expect.objectContaining({ day, timing: "day" })]);
});

test("reads stored wearable step buckets and daily totals without combining them", () => {
  const entry = (code: string, value: number, when: object) => ({
    resource: {
      resourceType: "Observation",
      code: { text: "Steps", coding: [{ system: "http://loinc.org", code }] },
      valueQuantity: { value, code: "{steps}" },
      ...when,
    },
  });
  const rows = connectedDayObservations(
    {
      resourceType: "Bundle",
      entry: [
        entry("55423-8", 10, {
          effectivePeriod: {
            start: "2026-10-26T22:55:00Z",
            end: "2026-10-26T23:10:00Z",
          },
        }),
        entry("41950-7", 1000, { effectiveDateTime: day }),
      ],
    },
    "Google Health",
    day,
    zone,
  );
  expect(rows).toEqual([
    expect.objectContaining({ timing: "interval", interval_min: 15, value: 10 }),
    expect.objectContaining({ timing: "day", interval_min: 0, value: 1000 }),
  ]);
  expect(
    buildPickerCatalog([], [], rows).charts.map(({ view }) => view.presentation),
  ).toEqual(["intervals", "daily-summary"]);
});
