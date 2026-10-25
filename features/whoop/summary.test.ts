import { describe, expect, test } from "bun:test";

import {
  SYNTHETIC_WHOOP_PAYLOAD,
  SYNTHETIC_WINDOW,
} from "./fixtures/synthetic-sync-payload";
import { buildWhoopSummary } from "./summary";

describe("buildWhoopSummary golden", () => {
  const summary = buildWhoopSummary(SYNTHETIC_WHOOP_PAYLOAD, SYNTHETIC_WINDOW);

  test("emits exact citation keys, values and units", () => {
    expect(summary.metrics.map((m) => [m.key, m.value, m.unit ?? null])).toEqual([
      ["whoop.recovery.score.2026-01-02", 64, null],
      ["whoop.recovery.hrv.2026-01-02", 48.3, "ms"],
      ["whoop.recovery.rhr.2026-01-02", 52, "bpm"],
      ["whoop.recovery.spo2.2026-01-02", 96.4, "%"],
      ["whoop.recovery.score.2026-01-03", 40, null],
      ["whoop.cycle.strain.2026-01-01", 11.5, null],
      ["whoop.cycle.avg_hr.2026-01-01", 71, "bpm"],
      ["whoop.sleep.performance.2026-01-01", 88, "%"],
      ["whoop.sleep.efficiency.2026-01-01", 91.3, "%"],
      ["whoop.sleep.consistency.2026-01-01", 77, "%"],
      ["whoop.sleep.in_bed_min.2026-01-01", 450, "min"],
    ]);
  });

  test("labels and dates follow the metric day", () => {
    const fields = (index: number) => {
      const metric = summary.metrics[index];
      return [
        Object.keys(metric ?? {}).sort(),
        metric?.key,
        metric?.label,
        metric?.value,
        metric?.date,
        metric?.unit,
      ];
    };
    expect(fields(0)).toEqual([
      ["date", "key", "label", "value"],
      "whoop.recovery.score.2026-01-02",
      "Whoop recovery score (2026-01-02)",
      64,
      "2026-01-02",
      undefined,
    ]);
    expect(fields(10)).toEqual([
      ["date", "key", "label", "unit", "value"],
      "whoop.sleep.in_bed_min.2026-01-01",
      "Whoop time in bed (2026-01-01)",
      450,
      "2026-01-01",
      "min",
    ]);
  });

  test("missing values are absent, never zero", () => {
    const keys = summary.metrics.map((m) => m.key);
    expect(keys).not.toContain("whoop.recovery.hrv.2026-01-03");
    expect(keys).not.toContain("whoop.recovery.rhr.2026-01-03");
    expect(keys).not.toContain("whoop.recovery.score.2026-01-04");
    expect(keys).not.toContain("whoop.sleep.performance.2026-01-02");
  });

  test("narrative header and first cited line", () => {
    expect(summary.narrative.split("\n").slice(0, 3)).toEqual([
      "Whoop wearable context for 2026-01-01 to 2026-01-04.",
      "Cite metrics by their [key] when they inform your answer.",
      "- [whoop.recovery.score.2026-01-02] Whoop recovery score (2026-01-02): 64",
    ]);
    expect(summary.window).toEqual({ startDate: "2026-01-01", endDate: "2026-01-04" });
  });

  test("empty payload abstains with the fixed narrative", () => {
    expect(
      buildWhoopSummary(
        { recovery: [], cycles: [], sleep: [] },
        { startDate: "2026-01-01", endDate: "2026-01-02" },
      ),
    ).toEqual({
      window: { startDate: "2026-01-01", endDate: "2026-01-02" },
      metrics: [],
      narrative: "No Whoop metrics were available for this window.",
    });
  });
});
