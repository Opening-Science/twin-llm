import { describe, expect, test } from "bun:test";

import { type ReferenceInterval } from "@/packages/biomarkers/anchor-layer";
import { biomarkerById } from "@/packages/biomarkers/catalogue";

import {
  D11_NO_POSITION,
  highlightFromLabel,
  NO_PUBLISHED_RANGE,
  RANGE_NOT_CHOSEN,
  VITALS_GROUP,
} from "./biomarker-copy";
import {
  englishName,
  latestVitals,
  noValueOpen,
  splitByValue,
  valueCountLine,
  markerRows,
  rangeText,
  vitalRows,
  type LabValue,
} from "./biomarker-rows";

// Midday UTC, so the local calendar day is the same in every test time zone.
const LABS: readonly LabValue[] = [
  { loinc: "2571-8", value: 150, unitUcum: "mg/dL", effectiveAt: "2024-11-20T12:00:00Z" },
  { loinc: "4548-4", value: 6.1, unitUcum: "%", effectiveAt: "2025-03-01T12:00:00Z" },
  {
    loinc: "2823-3",
    value: 3.5,
    unitUcum: "mmol/L",
    effectiveAt: "2025-03-01T12:00:00Z",
  },
  { loinc: "2276-4", value: 30, unitUcum: "ug/L", effectiveAt: "2025-03-01T12:00:00Z" },
  { loinc: "718-7", value: 13.41, unitUcum: "g/dL", effectiveAt: "2025-03-01T12:00:00Z" },
];

const rowsById = (labs: readonly LabValue[] | null, context = {}) =>
  new Map(markerRows(labs, context).map((row) => [row.id, row]));

const interval = (low: number | null, high: number | null, unit: string) =>
  ({ low, high, unitUcum: unit }) as ReferenceInterval;

describe("englishName", () => {
  test("the LOINC display up to its bracket, or null when it repeats the German name", () => {
    expect(englishName(biomarkerById("BM-140")!)).toBe("Cholesterol in HDL");
    expect(englishName(biomarkerById("BM-139")!)).toBe(
      "Hemoglobin A1c/Hemoglobin.total in Blood",
    );
    expect(englishName(biomarkerById("BM-107")!)).toBeNull();
  });
});

describe("rangeText", () => {
  test("closed, upper-only and lower-only ranges, grouped as published", () => {
    expect(rangeText(interval(1600, 4490, "ng/mL"))).toBe("1,600–4,490 ng/mL");
    expect(rangeText(interval(null, 5, "mg/L"))).toBe("≤ 5 mg/L");
    expect(rangeText(interval(40, null, "mg/dL"))).toBe("≥ 40 mg/dL");
    expect(rangeText(interval(4.63, 204, "ng/mL"))).toBe("4.63–204 ng/mL");
    expect(rangeText(interval(null, 5.7, "%"))).toBe("≤ 5.7%");
    expect(rangeText(interval(null, null, "%"))).toBeNull();
  });
});

describe("markerRows", () => {
  test("all 67 markers, grouped by Anchor system, German names in order", () => {
    const rows = markerRows(null);
    expect(rows).toHaveLength(67);
    expect([...new Set(rows.map((row) => row.group))]).toEqual([
      "Musculoskeletal",
      "Cardiovascular",
      "Digestive",
      "Metabolic",
      "Endocrine",
      "Reproductive",
    ]);
    expect(rows.slice(0, 5).map((row) => [row.id, row.label])).toEqual([
      ["bm:BM-063", "Calcium"],
      ["bm:BM-078", "Creatinkinase (CK)"],
      ["bm:BM-434", "CTX (Beta-Crosslaps)"],
      ["bm:BM-435", "Desoxypyridinolin (DPD)"],
      ["bm:BM-401", "Vitamin D (25-OH)"],
    ]);
    expect(rows.every((row) => row.value === null)).toBe(true);
  });

  test("a bound is inclusive: triglycerides at 150 sit within 44–150", () => {
    expect(rowsById(LABS).get("bm:BM-383")).toMatchObject({
      label: "Triglyceride",
      value: "150 mg/dL",
      details: [
        "Published range 44–150 mg/dL · Anchor v3",
        "Within the published range · 20 Nov 2024",
      ],
    });
  });

  test("above and below, worded neutrally with the day measured", () => {
    const rows = rowsById(LABS);
    expect(rows.get("bm:BM-139")).toMatchObject({
      value: "6.1%",
      details: [
        "Published range ≤ 5.7% · Anchor v3",
        "Above the published range · 1 Mar 2025",
      ],
    });
    expect(rows.get("bm:BM-177")?.details).toEqual([
      "Published range 3.6–5.5 mmol/L · Anchor v3",
      "Below the published range · 1 Mar 2025",
    ]);
  });

  test("ranges that need sex or age get none without them, and units are never converted", () => {
    expect(rowsById(LABS).get("bm:BM-107")).toMatchObject({
      value: "30 ug/L",
      details: [RANGE_NOT_CHOSEN, "1 Mar 2025"],
    });
    expect(
      rowsById(LABS, { sex: "male", ageYears: 40 }).get("bm:BM-107")?.details,
    ).toEqual([
      "Published range 21.8–275 ng/mL · Anchor v3",
      "No position: measured in ug/L, range in ng/mL · 1 Mar 2025",
    ]);
  });

  test("no published range, and Anchor's BLOCKING unit flag", () => {
    const rows = rowsById(LABS);
    expect(rows.get("bm:BM-423")).toMatchObject({
      value: "13.41 g/dL",
      details: [NO_PUBLISHED_RANGE, "1 Mar 2025"],
    });
    expect(rows.get("bm:BM-060")?.details).toEqual([
      "Published range 37.4–101 ug/L · Anchor v3",
      D11_NO_POSITION,
    ]);
  });

  test("search finds a row by Anchor id, LOINC code or English name", () => {
    expect(rowsById(null).get("bm:BM-140")?.search).toBe(
      "BM-140 2085-9 Cholesterol in HDL",
    );
  });
});

describe("vitals", () => {
  const METRICS = [
    { key: "whoop.cycle.avg_hr.2026-10-16", label: "Avg HR", value: 70, unit: "bpm" },
    { key: "sleep.hr.2026-10-14", label: "Sleep HR", value: 58, unit: "bpm" },
    { key: "sleep.hr.2026-10-15", label: "Sleep HR", value: 61, unit: "bpm" },
    { key: "google.steps.2026-10-15", label: "Steps", value: 8012, unit: "" },
    { key: "readiness.score.2026-10-15", label: "Readiness", value: 80 },
  ];

  test("first source in the table that has data, newest day; composite scores ignored", () => {
    expect(latestVitals(METRICS).map(({ vital, metric }) => [vital, metric.key])).toEqual(
      [
        ["heartRate", "sleep.hr.2026-10-15"],
        ["steps", "google.steps.2026-10-15"],
      ],
    );
  });

  test("rows under Vitals with the source's own label and day", () => {
    const [heart, steps] = vitalRows(latestVitals(METRICS));
    expect(heart).toMatchObject({
      id: "vital:heartRate",
      label: "Heart rate",
      english: "Average heart rate during sleep",
      group: VITALS_GROUP,
      value: "61 bpm",
      details: ["15 Oct 2026"],
    });
    expect(steps).toMatchObject({
      id: "vital:steps",
      label: "Steps",
      details: ["Steps; the whole system is shown", "15 Oct 2026"],
    });
  });
});

describe("highlightFromLabel", () => {
  test("names the row kind for the anatomy Highlight select", () => {
    expect(highlightFromLabel("marker", "Gamma-GT (GGT)")).toBe(
      "From biomarker: Gamma-GT (GGT)",
    );
    expect(highlightFromLabel("vital", "Heart rate")).toBe("From vital: Heart rate");
  });
});

describe("valued rows first", () => {
  // The LOINC codes a synthetic cohort person (synthea-v4-seed42) has values for.
  const COHORT_LOINCS = [
    "2085-9",
    "2093-3",
    "2160-0",
    "2571-8",
    "2823-3",
    "2951-2",
    "4544-3",
    "6690-2",
    "718-7",
    "777-3",
    "785-6",
    "786-4",
    "787-2",
    "789-8",
  ];
  const cohort = markerRows(
    COHORT_LOINCS.map((loinc) => ({
      loinc,
      value: 1,
      unitUcum: "1",
      effectiveAt: "2025-03-01T12:00:00Z",
    })),
  );

  test("Demo: valued markers in their Anchor groups, in order, then the rest", () => {
    const { withValues, without } = splitByValue(cohort);
    expect(withValues.map((row) => [row.id, row.group])).toEqual([
      ["bm:BM-072", "Cardiovascular"],
      ["bm:BM-140", "Cardiovascular"],
      ["bm:BM-383", "Cardiovascular"],
      ["bm:BM-425", "Metabolic"],
      ["bm:BM-424", "Metabolic"],
      ["bm:BM-423", "Metabolic"],
      ["bm:BM-177", "Metabolic"],
      ["bm:BM-436", "Metabolic"],
      ["bm:BM-426", "Metabolic"],
      ["bm:BM-429", "Metabolic"],
      ["bm:BM-430", "Metabolic"],
      ["bm:BM-428", "Metabolic"],
      ["bm:BM-286", "Metabolic"],
      ["bm:BM-427", "Metabolic"],
    ]);
    expect(without.slice(0, 3).map((row) => row.id)).toEqual([
      "bm:BM-063",
      "bm:BM-078",
      "bm:BM-434",
    ]);
    expect(without).toHaveLength(53);
    expect(valueCountLine(cohort)).toBe("14 with values · 67 in Anchor v3");
  });

  test("Self-shaped: only the wearable Vitals group has values", () => {
    const rows = [
      ...markerRows(null),
      ...vitalRows(
        latestVitals([
          { key: "sleep.hr.2026-10-15", label: "Sleep HR", value: 61, unit: "bpm" },
          { key: "google.steps.2026-10-15", label: "Steps", value: 8012, unit: "" },
        ]),
      ),
    ];
    const { withValues, without } = splitByValue(rows);
    expect(withValues.map((row) => [row.id, row.group])).toEqual([
      ["vital:heartRate", "Vitals"],
      ["vital:steps", "Vitals"],
    ]);
    expect(without).toHaveLength(67);
    expect(valueCountLine(rows)).toBe(
      "0 with values · 67 in Anchor v3 · 2 wearable vitals",
    );
    expect(valueCountLine(rows.slice(0, -1))).toBe(
      "0 with values · 67 in Anchor v3 · 1 wearable vital",
    );
  });

  test("the no-value section opens for a choice, a search hit or the selected row", () => {
    const closed = { userOpen: false, query: "", matches: 0, selectedInside: false };
    expect(noValueOpen(closed)).toBe(false);
    expect(noValueOpen({ ...closed, userOpen: true })).toBe(true);
    expect(noValueOpen({ ...closed, query: "ferritin", matches: 1 })).toBe(true);
    expect(noValueOpen({ ...closed, query: "ferritin", matches: 0 })).toBe(false);
    expect(noValueOpen({ ...closed, query: "  ", matches: 53 })).toBe(false);
    expect(noValueOpen({ ...closed, selectedInside: true })).toBe(true);
  });
});
