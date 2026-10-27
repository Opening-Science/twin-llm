import { describe, expect, test } from "bun:test";

import {
  type BiomarkerCardSpec,
  type CompareSpec,
  type TableSpec,
  writtenDecimals,
} from "@/infrastructure/chat-view";

import {
  cellText,
  columnDecimals,
  compareDeltaText,
  compareWindowText,
  positionText,
  rangeBar,
  rangeSourceText,
  rangeText,
  tableNote,
  trendText,
  valueText,
} from "./view-text";

const card: BiomarkerCardSpec = {
  measure: "2951-2",
  label: "Sodium",
  subject: "synthetic-subject-1",
  window: { start: "2026-01-01", end: "2026-10-31" },
  value: 146,
  unit: "mmol/L",
  at: "2026-08-01T08:00:00.000Z",
  n: 3,
  range: {
    low: 135,
    high: 145,
    unit: "mmol/L",
    population: "general_adult",
    source: "Anchor v3",
  },
  position: "above",
  dependsOn: [],
  trend: { n: 3, direction: "up", slopePerDay: 0.0387, slopeUnit: "mmol/L/d" },
};

describe("biomarker card words", () => {
  test("value, range, source, position and trend", () => {
    expect(valueText(card)).toBe("146 mmol/L");
    expect(rangeText(card)).toBe("135–145 mmol/L");
    expect(rangeSourceText(card)).toBe("Anchor v3, general adult");
    expect(positionText(card)).toBe("Above the range");
    expect(positionText({ ...card, position: "within" })).toBe("Within the range");
    expect(positionText({ ...card, position: "below" })).toBe("Below the range");
    expect(trendText(card)).toBe("↑ Rising · n = 3");
    expect(trendText({ ...card, trend: { ...card.trend, direction: "level" } })).toBe(
      "→ Level · n = 3",
    );
    expect(
      trendText({
        ...card,
        trend: { n: 2, direction: null, slopePerDay: null, slopeUnit: null },
      }),
    ).toBe("No trend: too few readings · n = 2");
  });

  test("a range that depends on facts names them; open bounds read as ≤ and ≥", () => {
    const depends = {
      ...card,
      range: null,
      position: null,
      dependsOn: ["sex", "age"] as const,
    };
    expect(positionText({ ...depends, dependsOn: [...depends.dependsOn] })).toBe(
      "Range depends on sex and age, which the record does not hold",
    );
    expect(rangeText({ ...depends, dependsOn: [] })).toBeNull();
    const hba1c = {
      ...card,
      value: 5.4,
      unit: "%",
      range: { ...card.range!, low: null, high: 5.7, unit: "%" },
    };
    expect(rangeText(hba1c)).toBe("≤ 5.7%");
    expect(valueText(hba1c)).toBe("5.4%");
    expect(rangeText({ ...card, range: { ...card.range!, high: null, low: 3 } })).toBe(
      "≥ 3 mmol/L",
    );
  });

  test("the bar places range and value as fractions of its width", () => {
    // 135–145 padded by 2.5 each side: 132.5 to 147.5.
    expect(rangeBar(card)).toEqual({ from: 2.5 / 15, to: 12.5 / 15, marker: 13.5 / 15 });
    expect(rangeBar({ ...card, range: null })).toBeNull();
  });

  test("stored decimals are kept, up to three", () => {
    expect([
      writtenDecimals(146),
      writtenDecimals(0.35),
      writtenDecimals(4.12345),
    ]).toEqual([0, 2, 3]);
  });
});

describe("compare words", () => {
  const spec: CompareSpec = {
    measure: "93832-4",
    label: "Sleep duration",
    unit: "h",
    subject: null,
    layout: "side-by-side",
    before: { start: "2026-08-31", end: "2026-09-27", n: 3, mean: 7, points: [] },
    after: { start: "2026-09-28", end: "2026-10-04", n: 2, mean: 6.25, points: [] },
    meanDelta: -0.75,
  };

  test("n and mean per window, and the difference in words", () => {
    expect(compareWindowText(spec.before, "h", 1)).toBe("n = 3 · mean 7.0 h");
    expect(compareWindowText(spec.after, "h", 1)).toBe("n = 2 · mean 6.3 h");
    expect(compareWindowText({ ...spec.before, n: 0, mean: null }, "h", 1)).toBe(
      "n = 0 · no readings",
    );
    expect(compareDeltaText(spec, 1)).toBe("Mean 0.8 h lower than before");
    expect(compareDeltaText({ ...spec, meanDelta: 0.5 }, 1)).toBe(
      "Mean 0.5 h higher than before",
    );
    expect(compareDeltaText({ ...spec, meanDelta: 0.01 }, 1)).toBe("Same mean as before");
    expect(compareDeltaText({ ...spec, meanDelta: null }, 1)).toBeNull();
  });
});

describe("table words", () => {
  const spec: TableSpec = {
    measure: "93832-4",
    label: "Sleep duration",
    unit: "h",
    window: { start: "2026-01-01", end: "2026-04-30" },
    subject: "s-1",
    columns: [
      { key: "at", label: "Date", format: "date" },
      { key: "value", label: "Value", format: "number" },
    ],
    rows: [
      { at: "2026-01-01T08:00:00.000Z", value: 6 },
      { at: "2026-01-02T08:00:00.000Z", value: 6.5 },
    ],
    total: 120,
  };

  test("a cut table says how much it shows", () => {
    expect(tableNote(spec)).toBe("Showing first 2 of 120");
    expect(tableNote({ ...spec, total: 2 })).toBeNull();
  });

  test("cells: days, numbers at the column's decimals, a dash when empty", () => {
    expect(columnDecimals(spec)).toEqual({ at: 0, value: 1 });
    expect(cellText("2026-01-02T08:00:00.000Z", "date", 0)).toBe("2 Jan 2026");
    expect(cellText(6, "number", 1)).toBe("6.0");
    expect(cellText(null, "number", 1)).toBe("—");
    expect(cellText("Sodium", "text", 0)).toBe("Sodium");
  });
});
