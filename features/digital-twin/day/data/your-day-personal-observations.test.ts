import { expect, test } from "bun:test";

import { SYNTHETIC_OURA_DATA } from "@/features/oura/fixtures/synthetic-sync-data";
import { SYNTHETIC_WHOOP_PAYLOAD } from "@/features/whoop/fixtures/synthetic-sync-payload";
import { buildOuraFhirBundle } from "@/infrastructure/open-twin-adapters/oura";
import { buildWhoopFhirBundle } from "@/infrastructure/open-twin-adapters/whoop";
import { MEASURES } from "@/packages/personal-data/wearable-measure-codes";

import { buildPickerCatalog } from "../charts/your-day-picker-catalog";
import {
  connectedDayObservations,
  importedDayObservations,
} from "./your-day-personal-observations";

const SYNTHETIC_SUBJECT = "synthetic-wearer-1";
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

test("links personal readings to their catalogue entry without hiding a source", () => {
  const heartRate = (source: string, value: number) =>
    connectedDayObservations(
      {
        resourceType: "Bundle",
        entry: [
          {
            resource: {
              resourceType: "Observation",
              code: {
                text: "Heart rate",
                coding: [{ system: "http://loinc.org", code: "8867-4" }],
              },
              valueQuantity: { value, code: "/min" },
              effectiveDateTime: "2026-10-27T07:00:00Z",
            },
          },
        ],
      },
      source,
      day,
      zone,
    );
  const rows = [
    ...heartRate("WHOOP", 58),
    ...heartRate("Google Health", 61),
    ...importedDayObservations([{ ...lab, unit: "ug/L" }], day, zone),
  ];
  const { entries, charts } = buildPickerCatalog([], undefined, rows);

  expect(
    entries
      .filter(({ label }) => label === "Heart rate")
      .map(({ chartId, category, provider }) => ({
        linked: chartId !== null,
        category,
        provider,
      })),
  ).toEqual([
    { linked: true, category: "Cardiovascular", provider: "WHOOP" },
    { linked: true, category: "Cardiovascular", provider: "Google Health" },
  ]);
  expect(entries.filter(({ label }) => label === "Ferritin")).toEqual([
    expect.objectContaining({ chartId: charts.at(-1)?.id }),
  ]);
  expect(charts.at(-1)).toMatchObject({ marker: { id: "BM-107" } });
  expect(
    entries.some(({ chartId, category }) => chartId && category === "Unassigned"),
  ).toBe(false);
});

test("links vendor-coded wearable readings by the statistic they name", () => {
  const meta = { subjectKey: SYNTHETIC_SUBJECT, timestamp: "2026-01-05T00:00:00Z" };
  const whoop = buildWhoopFhirBundle(SYNTHETIC_WHOOP_PAYLOAD, meta);
  const oura = buildOuraFhirBundle(
    SYNTHETIC_OURA_DATA,
    { types: ["daily_spo2"], start_date: "2026-01-01", end_date: "2026-01-04" },
    meta,
  );
  const rows = [
    ...connectedDayObservations(whoop, "WHOOP", "2026-01-02", "UTC"),
    ...connectedDayObservations(oura, "Oura", "2026-01-02", "UTC"),
    // Coded as the WHOOP cycle mapper codes it: the shared LOINC plus the statistic.
    ...connectedDayObservations(
      {
        resourceType: "Bundle",
        entry: [
          {
            resource: {
              resourceType: "Observation",
              code: {
                coding: [
                  { system: "http://loinc.org", code: "8867-4", display: "Heart rate" },
                  {
                    system: "http://opentwin.ch/fhir/CodeSystem/whoop",
                    code: "cycle-average-heart-rate",
                    display: "WHOOP cycle average heart rate",
                  },
                ],
              },
              valueQuantity: { value: 71, code: "/min" },
              effectiveDateTime: "2026-01-02T06:30:00Z",
            },
          },
        ],
      },
      "WHOOP",
      "2026-01-02",
      "UTC",
    ),
  ];
  const { entries } = buildPickerCatalog([], [], rows);
  const linked = (measure: { display: string }) =>
    entries
      .filter(({ label, chartId }) => label === measure.display && chartId)
      .map(({ provider }) => provider);

  expect(linked(MEASURES.restingHeartRate)).toEqual(["WHOOP"]);
  expect(linked(MEASURES.hrvRmssd)).toEqual(["WHOOP"]);
  expect(linked(MEASURES.workoutHeartRate)).toEqual(["WHOOP"]);
  expect(linked(MEASURES.oxygenSaturation).sort()).toEqual(["Oura", "WHOOP"]);
  expect(linked(MEASURES.heartRate)).toEqual([]);
  expect(
    entries.find(({ label }) => label === "WHOOP cycle average heart rate"),
  ).toMatchObject({ category: "Unassigned" });
});

test("plots Oura's daily records as summaries on the wearer's own date", () => {
  const oura = buildOuraFhirBundle(
    [
      {
        type: "daily_activity",
        data: {
          next_token: null,
          data: [
            {
              id: "activity-synthetic-1",
              day: "2026-01-02",
              timestamp: "2026-01-02T00:00:00+01:00",
              score: 81,
              steps: 9_120,
              contributors: { stay_active: 88 },
            },
          ],
        },
      },
    ] as never,
    { types: ["daily_activity"], start_date: "2026-01-01", end_date: "2026-01-04" },
    { subjectKey: SYNTHETIC_SUBJECT, timestamp: "2026-01-05T00:00:00Z" },
  );
  // Local midnight east of UTC is the previous UTC day; the record still belongs to its own.
  const rows = connectedDayObservations(oura, "Oura", "2026-01-02", "UTC");
  expect(rows.map(({ label, timing, value }) => ({ label, timing, value }))).toEqual(
    expect.arrayContaining([
      { label: "Oura Activity Score", timing: "day", value: 81 },
      expect.objectContaining({ timing: "day", value: 9_120 }),
    ]),
  );
  expect(rows.every(({ timing }) => timing === "day")).toBe(true);
  expect(rows.map(({ value, provenance }) => [value, provenance])).toEqual(
    expect.arrayContaining([
      [81, "derived"],
      [88, "derived"],
      [9_120, "measured"],
    ]),
  );
  expect(connectedDayObservations(oura, "Oura", "2026-01-01", "UTC")).toEqual([]);
  expect(
    buildPickerCatalog([], [], rows).entries.find(
      ({ label, chartId }) => label === MEASURES.stepsPerDay.display && chartId,
    ),
  ).toMatchObject({ provider: "Oura" });
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
  expect(rows).toEqual([
    expect.objectContaining({
      day,
      timing: "day",
      provenance: "imported",
      value: lab.value,
      unit: lab.unit,
    }),
  ]);
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

test("sends opaque per-response keys, never row or dataset ids", () => {
  const rows = importedDayObservations(
    [
      { ...lab, id: "row-ferritin-db", datasetId: "dataset-lab-db" },
      { ...lab, id: "row-ferritin-db-2", datasetId: "dataset-lab-db", value: 47 },
      { ...lab, id: "row-other-db", datasetId: "dataset-other-db", value: 50 },
    ],
    day,
    zone,
  );
  const payload = JSON.stringify(rows);
  for (const id of [
    "row-ferritin-db",
    "row-other-db",
    "dataset-lab-db",
    "dataset-other-db",
  ])
    expect(payload).not.toContain(id);
  expect(rows.map(({ id, sourceId }) => [id, sourceId])).toEqual([
    ["import-row:0", "import-set:0"],
    ["import-row:1", "import-set:0"],
    ["import-row:2", "import-set:1"],
  ]);
  // Two imports of the same measure still chart apart.
  expect(buildPickerCatalog([], [], rows).charts).toHaveLength(2);
});
