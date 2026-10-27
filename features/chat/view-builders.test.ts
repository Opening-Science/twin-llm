import { describe, expect, test } from "bun:test";

import { writtenDecimals } from "@/infrastructure/chat-view";

import {
  cardLabel,
  rowsOf,
  TABLE_ROW_CAP,
  tableColumns,
  tableSpecOf,
  trendDirection,
} from "./view-builders";

describe("trendDirection", () => {
  test("the fitted change, rounded as the value is shown, decides the arrow", () => {
    expect(trendDirection({ fitted_first: 139.2, fitted_last: 145.8 }, 0)).toBe("up");
    expect(trendDirection({ fitted_first: 5.64, fitted_last: 5.41 }, 1)).toBe("down");
    expect(trendDirection({ fitted_first: 140.2, fitted_last: 140.4 }, 0)).toBe("level");
    expect(trendDirection({ fitted_first: 5.41, fitted_last: 5.44 }, 1)).toBe("level");
    expect(trendDirection({ fitted_first: null, fitted_last: null }, 0)).toBeNull();
  });

  test("the arrow rounds to the decimals the value was written with", () => {
    expect([writtenDecimals(146), writtenDecimals(5.7), writtenDecimals(0.35)]).toEqual([
      0, 1, 2,
    ]);
    expect(trendDirection({ fitted_first: 0.35, fitted_last: 0.39 }, 2)).toBe("up");
  });
});

describe("cardLabel", () => {
  test("the LOINC display without its bracketed property, or the code", () => {
    expect(cardLabel("Sodium [Moles/volume] in Serum or Plasma", "2951-2")).toBe(
      "Sodium",
    );
    expect(cardLabel("Hemoglobin A1c/Hemoglobin.total in Blood", "4548-4")).toBe(
      "Hemoglobin A1c/Hemoglobin.total in Blood",
    );
    expect(cardLabel(null, "2951-2")).toBe("2951-2");
  });
});

describe("table columns", () => {
  const observations = {
    rows: [
      {
        subject_ref: "s-1",
        loinc: "2951-2",
        display: "Sodium",
        value: 139,
        unit_ucum: "mmol/L",
        effective_at: "2026-02-01T08:00:00.000Z",
      },
      {
        subject_ref: "s-1",
        loinc: "2823-3",
        display: "Potassium",
        value: 4.2,
        unit_ucum: "mmol/L",
        effective_at: "2026-02-01T08:00:00.000Z",
      },
    ],
  };

  test("observations_for_subject rows: text that never changes is left to the caption", () => {
    expect(tableColumns(rowsOf(observations))).toEqual([
      { key: "effective_at", label: "Date", format: "date" },
      { key: "display", label: "Measure", format: "text" },
      { key: "loinc", label: "LOINC", format: "text" },
      { key: "value", label: "Value", format: "number" },
    ]);
  });

  test("coverage rows keep their counts; a field no column lists is never shown", () => {
    const coverage = {
      start: "2026-10-01",
      codes: [
        {
          loinc: "93832-4",
          unit: "h",
          n: 6,
          days_with_data: 6,
          coverage_ratio: 0.857,
          longest_gap_days: 1,
          secret: "x",
        },
      ],
    };
    expect(tableColumns(rowsOf(coverage)).map((column) => column.key)).toEqual([
      "loinc",
      "unit",
      "n",
      "days_with_data",
      "coverage_ratio",
      "longest_gap_days",
    ]);
  });

  test("an output without rows has none", () => {
    expect(rowsOf({ n: 3, mean: 4 })).toEqual([]);
    expect(rowsOf(null)).toEqual([]);
  });

  test("a value that is not a finite number is an empty cell, never 0", () => {
    const spec = tableSpecOf({
      output: {
        points: [
          { at: "2026-10-01T00:00:00.000Z", value: 7 },
          { at: "2026-10-02T00:00:00.000Z", value: "7.5" },
        ],
      },
      measure: "sleep.duration",
      label: "Sleep",
      unit: "h",
      window: { start: "2026-10-01", end: "2026-10-02" },
      subject: null,
    });
    expect(spec.rows).toEqual([
      { at: "2026-10-01T00:00:00.000Z", value: 7 },
      { at: "2026-10-02T00:00:00.000Z", value: null },
    ]);
    expect(spec.total).toBe(2);
    expect(TABLE_ROW_CAP).toBe(50);
  });
});
