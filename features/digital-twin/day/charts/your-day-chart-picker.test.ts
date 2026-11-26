import { expect, test } from "bun:test";

import { listBiomarkers } from "@/packages/biomarkers/catalogue";
import { MEASURES } from "@/packages/personal-data/wearable-measure-codes";

import { toggleYourDayChart } from "./your-day-charts";
import {
  buildPickerCatalog,
  filterPickerCatalog,
  paginatePickerCatalog,
} from "./your-day-picker-catalog";
import { yourDayReplayFixtures } from "../data/your-day-replay-demo";

const days = yourDayReplayFixtures().map(({ chartData }) => chartData.day);
const catalog = buildPickerCatalog(days);
const search = (query: string, category = "") =>
  filterPickerCatalog(catalog.entries, query, category);

test("paginates nine biomarkers with a bounded three-page window", () => {
  const entries = catalog.entries.slice(0, 38);
  expect(paginatePickerCatalog(entries, 0)).toEqual({
    entries: entries.slice(0, 9),
    firstResult: 1,
    lastResult: 9,
    pageCount: 5,
    visiblePages: [0, 1, 2],
  });
  expect(paginatePickerCatalog(entries, 2).visiblePages).toEqual([1, 2, 3]);
  expect(paginatePickerCatalog(entries, 4)).toEqual({
    entries: entries.slice(36),
    firstResult: 37,
    lastResult: 38,
    pageCount: 5,
    visiblePages: [2, 3, 4],
  });
});

test("handles single-page, exact page size, and empty results", () => {
  const entries = catalog.entries.slice(0, 9);
  expect(paginatePickerCatalog(entries, 0)).toEqual({
    entries,
    firstResult: 1,
    lastResult: 9,
    pageCount: 1,
    visiblePages: [0],
  });
  expect(paginatePickerCatalog([], 0)).toEqual({
    entries: [],
    firstResult: 0,
    lastResult: 0,
    pageCount: 0,
    visiblePages: [],
  });
});

test("groups replay measures and Anchor lab markers under the same body systems", () => {
  expect(catalog.categories).toEqual(
    expect.arrayContaining(["Cardiovascular", "Metabolic", "Musculoskeletal", "Nervous"]),
  );
  expect(search("8867-4", "Cardiovascular").map(({ id }) => id)).toEqual(["heart_rate"]);
  expect(search("steps", "Musculoskeletal").map(({ id }) => id)).toEqual([
    "steps",
    "wearable:stepsPerDay",
  ]);
  expect(search("RMSSD", "Nervous").map(({ id }) => id)).toEqual(["hrv_rmssd"]);
  expect(
    search("  GLUCOSE mg/dL ", "Metabolic")
      .map(({ id }) => id)
      .sort(),
  ).toEqual(["anchor:BM-128", "blood_glucose", "glucose"]);
  expect(search("sleep", "Nervous").find(({ id }) => id === "sleep")).toMatchObject({
    chartId: null,
    unavailableReason: "Sleep is shown on the replay timeline, not as a chart.",
  });
});

test("lists the full wearable registry even when no replay readings exist", () => {
  const { entries, charts } = buildPickerCatalog([], []);
  expect(charts).toEqual([]);
  expect(entries.map(({ id }) => id).sort()).toEqual(
    Object.keys(MEASURES)
      .map((key) => `wearable:${key}`)
      .sort(),
  );
  expect(entries.every(({ chartId }) => chartId === null)).toBe(true);
  expect(search("59408-5", "Respiratory")).toEqual([
    expect.objectContaining({ label: MEASURES.oxygenSaturation.display, chartId: null }),
  ]);
  expect(
    search("heart rate", "Cardiovascular").filter(
      ({ label }) => label === MEASURES.heartRate.display,
    ),
  ).toEqual([expect.objectContaining({ chartId: "heart_rate" })]);
});

test("discovers available series instead of listing a fixed set of charts", () => {
  expect(catalog.charts.map(({ id }) => id).sort()).toEqual([
    "blood_glucose",
    "glucose",
    "heart_rate",
    "hrv_rmssd",
    "resting_heart_rate",
    "steps",
  ]);
  const day = days[0]!;
  const heartOnly = buildPickerCatalog([
    {
      ...day,
      readings: day.readings.filter(({ stream }) => stream === "heart_rate"),
    },
  ]);
  expect(heartOnly.charts.map(({ id }) => id)).toEqual(["heart_rate"]);
  expect(buildPickerCatalog([]).charts).toEqual([]);
});

test("merges an exact LOINC and UCUM match without duplicating the picker entry", () => {
  const marker = {
    ...listBiomarkers()[0]!,
    id: "test-heart-rate",
    loincCode: "8867-4",
    loincDisplay: "Heart rate",
    systemId: "cardiovascular" as const,
    unitUcum: "/min",
    blocked: false,
  };
  const exact = buildPickerCatalog(days, [marker]).entries.filter(
    ({ id, chartId }) => id === "anchor:test-heart-rate" || chartId === "heart_rate",
  );
  expect(exact).toHaveLength(1);
  expect(exact[0]).toMatchObject({
    id: "anchor:test-heart-rate",
    chartId: "heart_rate",
    category: "Cardiovascular",
  });
  const withoutReadings = buildPickerCatalog([], [marker]).entries.filter(
    ({ label }) => label === MEASURES.heartRate.display,
  );
  expect(withoutReadings).toEqual([
    expect.objectContaining({ id: "anchor:test-heart-rate", chartId: null }),
  ]);
  const mismatch = buildPickerCatalog(days, [{ ...marker, unitUcum: "/h" }]).entries;
  expect(mismatch.find(({ id }) => id === "anchor:test-heart-rate")?.chartId).toBeNull();
  expect(mismatch.find(({ id }) => id === "heart_rate")?.chartId).toBe("heart_rate");
});

test("includes every Anchor biomarker without offering an unsupported replay chart", () => {
  const entries = catalog.entries.filter(({ id }) => id.startsWith("anchor:"));
  expect(entries.every(({ chartId }) => chartId === null)).toBe(true);
  expect(entries.map(({ id }) => id).sort()).toEqual(
    listBiomarkers()
      .map(({ id }) => `anchor:${id}`)
      .sort(),
  );
  const ferritin = search("  ferrITIN ").find((entry) => entry.label === "Ferritin");
  expect(ferritin).toMatchObject({
    chartId: null,
    provider: "Lab result (Anchor catalogue)",
  });
});

test("draft toggles leave active charts untouched and respect the six-card limit", () => {
  const active = ["heart_rate", "glucose"] as const;
  const draft = toggleYourDayChart(active, "steps");
  expect(draft).toEqual(["heart_rate", "glucose", "steps"]);
  expect(active).toEqual(["heart_rate", "glucose"]);
  expect(toggleYourDayChart(draft, "steps")).toEqual(active);

  const full = catalog.charts.map(({ id }) => id);
  expect(toggleYourDayChart(full, "heart_rate")).not.toContain("heart_rate");
  const alternativeDraft = [
    ...full.filter((id) => id !== "heart_rate"),
    "steps" as const,
  ];
  expect(toggleYourDayChart(alternativeDraft, "heart_rate")).toBe(alternativeDraft);
});
