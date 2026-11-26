import { expect, test } from "bun:test";

import { listBiomarkers } from "@/packages/biomarkers/catalogue";

import { DEFAULT_CHART_IDS, toggleYourDayChart } from "./your-day-charts";
import {
  BIOMARKER_PICKER_CATALOG,
  filterPickerCatalog,
  paginatePickerCatalog,
} from "./your-day-picker-catalog";

test("paginates nine biomarkers with a bounded three-page window", () => {
  const entries = BIOMARKER_PICKER_CATALOG.slice(0, 38);
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
  const entries = BIOMARKER_PICKER_CATALOG.slice(0, 9);
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

test("combines category and case-insensitive search across catalog details", () => {
  expect(filterPickerCatalog("  GLUCOSE mg/dL ", "Glucose").map(({ id }) => id)).toEqual([
    "glucose",
    "blood_glucose",
  ]);
  expect(filterPickerCatalog("8867-4", "Heart").map(({ id }) => id)).toEqual([
    "heart_rate",
  ]);
  expect(filterPickerCatalog("RMSSD", "Heart").map(({ id }) => id)).toEqual([
    "hrv_rmssd",
  ]);
  expect(filterPickerCatalog("glucose", "Activity")).toEqual([]);
});

test("includes every Anchor biomarker without offering an unsupported replay chart", () => {
  const entries = BIOMARKER_PICKER_CATALOG.filter(({ chartId }) => chartId === null);
  expect(entries.map(({ id }) => id).sort()).toEqual(
    listBiomarkers()
      .map(({ id }) => `anchor:${id}`)
      .sort(),
  );
  const ferritin = filterPickerCatalog("Ferritin", "").find(
    (entry) => entry.label === "Ferritin",
  );
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

  const full = [...DEFAULT_CHART_IDS, "heart_rate" as const].slice(0, 6);
  expect(toggleYourDayChart(full, "heart_rate")).not.toContain("heart_rate");
  const alternativeDraft = [
    ...full.filter((id) => id !== "heart_rate"),
    "steps" as const,
  ];
  expect(toggleYourDayChart(alternativeDraft, "heart_rate")).toBe(alternativeDraft);
});
