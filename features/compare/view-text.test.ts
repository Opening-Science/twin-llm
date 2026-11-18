import { describe, expect, test } from "bun:test";

import type {
  BiomarkerCardSpec,
  ChatView,
  CompareSpec,
} from "@/infrastructure/chat-view";

import {
  captionAside,
  cellText,
  columnDecimals,
  comparisonAlt,
  deltaLine,
  latestLine,
  positionText,
  rangeBar,
  rangeText,
  readoutText,
  seriesDecimals,
  seriesDomain,
  trendText,
  truncationLine,
  viewAnchorId,
  windowSummary,
} from "./view-text";

/** Synthetic specs only: no person's data. */

const window = { start: "2026-01-01", end: "2026-01-31" };

const compare = (overrides: Partial<CompareSpec> = {}): CompareSpec => ({
  measure: "sleep.duration",
  label: "Sleep duration",
  unit: "h",
  subject: null,
  layout: "side-by-side",
  before: {
    start: "2025-12-01",
    end: "2025-12-07",
    n: 7,
    mean: 6.7,
    points: [{ at: "2025-12-01", value: 6.5 }],
  },
  after: {
    start: "2026-01-01",
    end: "2026-01-07",
    n: 7,
    mean: 7.1,
    points: [{ at: "2026-01-01", value: 7.25 }],
  },
  meanDelta: 0.4,
  ...overrides,
});

const biomarker = (overrides: Partial<BiomarkerCardSpec> = {}): BiomarkerCardSpec => ({
  measure: "2823-3",
  label: "Potassium",
  subject: "29bbf012-0000-4000-8000-000000000001",
  window,
  value: 4.2,
  unit: "mmol/L",
  at: "2026-01-20",
  n: 12,
  range: {
    low: 3.6,
    high: 5.5,
    unit: "mmol/L",
    population: "adults",
    source: "Anchor v3",
  },
  position: "within",
  dependsOn: [],
  trend: { n: 12, direction: "up", slopePerDay: 0.01, slopeUnit: "mmol/L/d" },
  ...overrides,
});

describe("view anchors and captions", () => {
  test("an anchor is stable per answer and view, and safe as an id", () => {
    expect(viewAnchorId("turn-1:agent:gp", "view-12-13")).toBe(
      "view-turn-1-agent-gp-view-12-13",
    );
    expect(viewAnchorId("a", "v")).toBe(viewAnchorId("a", "v"));
  });

  test("the caption names the unit and, when there is one, the subject", () => {
    const view: ChatView = {
      id: "view-1",
      kind: "chart.timeseries",
      title: "Heart rate, 1 Jan 2026 – 31 Jan 2026",
      spec: {
        measure: "8867-4",
        label: "Heart rate",
        unit: "/min",
        window,
        subject: "29bbf012-aaaa",
        points: [],
      },
      sourceAuditIds: ["1"],
    };
    expect(captionAside(view)).toBe("bpm · subject 29bbf012");
    expect(
      captionAside({ ...view, spec: { ...view.spec, unit: null, subject: null } }),
    ).toBe("");
  });
});

describe("time series", () => {
  test("integer data shows no decimals; anything else one", () => {
    expect(seriesDecimals([60, 62, 71])).toBe(0);
    expect(seriesDecimals([60, 62.5])).toBe(1);
  });

  test("draws over the window, or the points' own range when some fall outside it", () => {
    const inside = seriesDomain([{ at: "2026-01-10", value: 1 }], window);
    expect(inside[0]).toBe(Date.parse("2026-01-01T00:00:00Z"));
    const outside = seriesDomain(
      [
        { at: "2025-06-01", value: 1 },
        { at: "2025-06-03", value: 2 },
      ],
      window,
    );
    expect(outside).toEqual([
      Date.parse("2025-06-01T00:00:00Z"),
      Date.parse("2025-06-03T00:00:00Z"),
    ]);
  });
});

describe("comparison", () => {
  test("each window's n and mean in words", () => {
    const spec = compare();
    expect(windowSummary(spec.after, "h", 1)).toBe("n = 7 · mean 7.1 h");
    expect(windowSummary({ ...spec.before, n: 0, mean: null, points: [] }, "h", 1)).toBe(
      "n = 0 · no readings",
    );
  });

  test("the difference reads higher, lower or the same", () => {
    expect(deltaLine(0.4, "h", 1)).toBe("Mean 0.4 h higher than before");
    expect(deltaLine(-0.4, "h", 1)).toBe("Mean 0.4 h lower than before");
    expect(deltaLine(0.01, "h", 1)).toBe("Same mean as before");
    expect(deltaLine(null, "h", 1)).toBeNull();
  });

  test("the chart's text alternative gives the title and both windows' n and mean", () => {
    const alt = comparisonAlt("Sleep duration", compare());
    expect(alt).toContain("Sleep duration.");
    expect(alt).toContain("Earlier window 1 Dec 2025 – 7 Dec 2025: n = 7 · mean 6.7 h.");
    expect(alt).toContain("Later window 1 Jan 2026 – 7 Jan 2026: n = 7 · mean 7.1 h.");
    expect(alt).toContain("Mean 0.4 h higher than before.");
  });
});

describe("biomarker card", () => {
  test("the latest value at its written decimals, with when and how many", () => {
    expect(readoutText(biomarker())).toBe("4.2 mmol/L");
    expect(latestLine(biomarker())).toBe(
      "latest, 20 Jan 2026 · 12 readings in the window",
    );
    expect(latestLine(biomarker({ n: 1 }))).toBe(
      "latest, 20 Jan 2026 · 1 reading in the window",
    );
  });

  test("position in words, or what it depends on", () => {
    expect(positionText(biomarker())).toBe("Within the range");
    expect(positionText(biomarker({ position: "above" }))).toBe("Above the range");
    expect(positionText(biomarker({ position: "below" }))).toBe("Below the range");
    expect(
      positionText(biomarker({ position: null, range: null, dependsOn: ["sex", "age"] })),
    ).toBe("The range depends on sex and age, which the record lacks");
    expect(positionText(biomarker({ position: null }))).toBe("No position");
  });

  test("ranges with bounds, one-sided ranges, source and population", () => {
    expect(rangeText(biomarker())).toBe("3.6–5.5 mmol/L (Anchor v3, adults)");
    const upper = biomarker({
      unit: "%",
      range: {
        low: null,
        high: 5.7,
        unit: "%",
        population: "adults",
        source: "Anchor v3",
      },
    });
    expect(rangeText(upper)).toBe("≤ 5.7% (Anchor v3, adults)");
    const lower = biomarker({
      range: {
        low: 3,
        high: null,
        unit: "ng/mL",
        population: "adults",
        source: "Anchor v3",
      },
    });
    expect(rangeText(lower)).toBe("≥ 3 ng/mL (Anchor v3, adults)");
  });

  test("trend words, and none with too few readings", () => {
    expect(trendText(biomarker())).toBe("↑ Rising · n = 12");
    expect(
      trendText(
        biomarker({
          trend: { n: 4, direction: "down", slopePerDay: -1, slopeUnit: null },
        }),
      ),
    ).toBe("↓ Falling · n = 4");
    expect(
      trendText(
        biomarker({
          trend: { n: 5, direction: "level", slopePerDay: 0, slopeUnit: null },
        }),
      ),
    ).toBe("→ Level · n = 5");
    expect(
      trendText(
        biomarker({
          trend: { n: 2, direction: null, slopePerDay: null, slopeUnit: null },
        }),
      ),
    ).toBe("No trend: too few readings · n = 2");
  });

  test("the bar puts the marker inside the range for a value within it", () => {
    const bar = rangeBar(biomarker());
    expect(bar).not.toBeNull();
    if (bar === null) return;
    expect(bar.marker).toBeGreaterThan(bar.from);
    expect(bar.marker).toBeLessThan(bar.to);
    expect(rangeBar(biomarker({ range: null }))).toBeNull();
  });
});

describe("table", () => {
  const rows = [
    { day: "2026-01-02", value: 4.25, note: "synthetic" },
    { day: "2026-01-03T08:00:00Z", value: 5, note: null },
  ];

  test("number columns keep the decimals they were written with, at most three", () => {
    expect(columnDecimals(rows, "value")).toBe(2);
    expect(columnDecimals([{ value: 1.23456 }], "value")).toBe(3);
  });

  test("dates as days, numbers at the column's decimals, missing as a dash", () => {
    expect(cellText("2026-01-03T08:00:00Z", "date", 0)).toBe("3 Jan 2026");
    expect(cellText(5, "number", 2)).toBe("5.00");
    expect(cellText(null, "text", 0)).toBe("—");
    expect(cellText(undefined, "number", 0)).toBe("—");
  });

  test("a cut table says how much it shows", () => {
    expect(truncationLine(50, 120)).toBe("Showing first 50 of 120");
    expect(truncationLine(12, 12)).toBeNull();
  });
});
