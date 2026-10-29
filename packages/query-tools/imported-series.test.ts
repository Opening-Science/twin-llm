import { describe, expect, test } from "bun:test";

import type {
  ImportedDatasetRecord,
  ImportedObservationRecord,
  ImportedSeriesGroup,
} from "./imported-ports";
import {
  newestPerCode,
  partialDateCount,
  seriesListing,
  storedUnits,
} from "./imported-series";

/** Made-up datasets and rows; no person's data. */
const LOINC = "http://loinc.org";

const DATASETS: readonly ImportedDatasetRecord[] = [
  {
    id: "ds-oura",
    kind: "wearable",
    name: "Made-up ring export",
    rowCount: 7,
    firstAt: "2026-01-01",
    lastAt: "2026-01-04",
  },
  {
    id: "ds-labs",
    kind: "lab-csv",
    name: "Made-up labs",
    rowCount: 5,
    firstAt: "2025-03",
    lastAt: "2026-01-05",
  },
];

const at = (iso: string): Date => new Date(iso);

const group = (
  datasetId: string,
  codeSystem: string | null,
  code: string | null,
  display: string,
  unit: string,
  n: number,
  first: string,
  last: string,
): ImportedSeriesGroup => ({
  datasetId,
  codeSystem,
  code,
  display,
  unit,
  n,
  firstAt: at(first),
  lastAt: at(last),
});

describe("seriesListing", () => {
  test("lists each dataset with its LOINC and by-name series kept apart", () => {
    const groups = [
      group(
        "ds-labs",
        LOINC,
        "2345-7",
        "Glucose",
        "mg/dL",
        2,
        "2026-01-01T08:00:00Z",
        "2026-01-03T08:00:00Z",
      ),
      group(
        "ds-labs",
        LOINC,
        "2345-7",
        "Glucose [Mass/volume]",
        "mg/dL",
        1,
        "2026-01-05T08:00:00Z",
        "2026-01-05T08:00:00Z",
      ),
      group(
        "ds-labs",
        LOINC,
        "2345-7",
        "Glucose",
        "mmol/L",
        1,
        "2025-03-01T00:00:00Z",
        "2025-03-01T00:00:00Z",
      ),
      group(
        "ds-labs",
        "http://snomed.info/sct",
        "1234",
        "Made-up local test",
        "U/L",
        1,
        "2026-01-02T08:00:00Z",
        "2026-01-02T08:00:00Z",
      ),
      group(
        "ds-oura",
        null,
        null,
        "HRV (RMSSD)",
        "ms",
        4,
        "2026-01-01T07:00:00Z",
        "2026-01-04T07:00:00Z",
      ),
      group(
        "ds-oura",
        LOINC,
        "80404-7",
        "HRV SDNN",
        "ms",
        3,
        "2026-01-01T07:00:00Z",
        "2026-01-03T07:00:00Z",
      ),
    ];
    expect(seriesListing(DATASETS, groups)).toEqual([
      {
        dataset_id: "ds-oura",
        kind: "wearable",
        name: "Made-up ring export",
        row_count: 7,
        first_at: "2026-01-01",
        last_at: "2026-01-04",
        series: [
          {
            loinc: "80404-7",
            name: "HRV SDNN",
            unit: "ms",
            n: 3,
            first_at: "2026-01-01T07:00:00.000Z",
            last_at: "2026-01-03T07:00:00.000Z",
          },
          {
            loinc: null,
            name: "HRV (RMSSD)",
            unit: "ms",
            n: 4,
            first_at: "2026-01-01T07:00:00.000Z",
            last_at: "2026-01-04T07:00:00.000Z",
          },
        ],
        other_coded_rows: 0,
      },
      {
        dataset_id: "ds-labs",
        kind: "lab-csv",
        name: "Made-up labs",
        row_count: 5,
        first_at: "2025-03",
        last_at: "2026-01-05",
        series: [
          {
            loinc: "2345-7",
            name: "Glucose",
            unit: "mg/dL",
            n: 3,
            first_at: "2026-01-01T08:00:00.000Z",
            last_at: "2026-01-05T08:00:00.000Z",
          },
          {
            loinc: "2345-7",
            name: "Glucose",
            unit: "mmol/L",
            n: 1,
            first_at: "2025-03-01T00:00:00.000Z",
            last_at: "2025-03-01T00:00:00.000Z",
          },
        ],
        other_coded_rows: 1,
      },
    ]);
  });

  test("a dataset with no observations (a research table) has no series", () => {
    expect(seriesListing([DATASETS[0] as ImportedDatasetRecord], [])).toEqual([
      {
        dataset_id: "ds-oura",
        kind: "wearable",
        name: "Made-up ring export",
        row_count: 7,
        first_at: "2026-01-01",
        last_at: "2026-01-04",
        series: [],
        other_coded_rows: 0,
      },
    ]);
  });
});

const reading = (
  id: string,
  code: string | null,
  iso: string,
  value: number,
): ImportedObservationRecord => ({
  id,
  datasetId: "ds-labs",
  code,
  display: code === null ? "By name" : `Code ${code}`,
  value,
  unit: "mg/dL",
  effectiveAt: at(iso),
  effectivePrecision: "instant",
});

describe("newestPerCode", () => {
  test("keeps the newest row per code in the order asked; a tie goes to the lower id", () => {
    const rows = [
      reading("r1", "2345-7", "2026-01-01T08:00:00Z", 90),
      reading("r3", "2345-7", "2026-01-05T08:00:00Z", 98),
      reading("r2", "2345-7", "2026-01-05T08:00:00Z", 97),
      reading("r4", "2093-3", "2026-01-02T08:00:00Z", 180),
      reading("r5", null, "2026-01-09T08:00:00Z", 1),
    ];
    expect(newestPerCode(rows, ["2093-3", "2345-7", "4548-4", "2345-7"])).toEqual({
      readings: [
        rows[3] as ImportedObservationRecord,
        rows[2] as ImportedObservationRecord,
      ],
      codesWithoutRows: ["4548-4"],
    });
  });

  test("no rows leaves every code without a row", () => {
    expect(newestPerCode([], ["2345-7"])).toEqual({
      readings: [],
      codesWithoutRows: ["2345-7"],
    });
  });
});

describe("storedUnits and partialDateCount", () => {
  test("units are compared as stored, so a different case is a different unit", () => {
    expect(
      storedUnits([{ unit: "mg/dl" }, { unit: "mg/dL" }, { unit: "mg/dL" }]),
    ).toEqual(["mg/dL", "mg/dl"]);
  });

  test("only month and year dates count as partial", () => {
    expect(
      partialDateCount([
        { effectivePrecision: "year" },
        { effectivePrecision: "month" },
        { effectivePrecision: "day" },
        { effectivePrecision: "instant" },
      ]),
    ).toBe(2);
  });
});
