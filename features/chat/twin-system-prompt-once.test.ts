import { describe, expect, test } from "bun:test";

import { buildTwinSystemPrompt, narrativeHeader } from "./twin-system-prompt";

const oura = {
  window: { startDate: "2026-01-01", endDate: "2026-01-02" },
  metrics: [
    {
      key: "sleep.hrv.long_sleep.2026-01-01",
      label: "HRV (2026-01-01)",
      value: 41,
      date: "2026-01-01",
      unit: "ms",
    },
    {
      key: "sleep.hrv.long_sleep.2026-01-02",
      label: "HRV (2026-01-02)",
      value: 44,
      date: "2026-01-02",
      unit: "ms",
    },
  ],
  narrative: [
    "Oura wearable context for 2026-01-01 to 2026-01-02.",
    "Cite metrics by their [key] when they inform your answer.",
    "- [sleep.hrv.long_sleep.2026-01-01] HRV (2026-01-01): 41 ms",
    "- [sleep.hrv.long_sleep.2026-01-02] HRV (2026-01-02): 44 ms",
  ].join("\n"),
};

describe("wearable metrics in the system prompt (#188)", () => {
  test("the narrative keeps its sentences and drops its metric lines", () => {
    expect(narrativeHeader(oura.narrative)).toBe(
      "Oura wearable context for 2026-01-01 to 2026-01-02.\nCite metrics by their [key] when they inform your answer.",
    );
  });

  test("each metric key appears once", () => {
    const prompt = buildTwinSystemPrompt({
      mode: "personal",
      oura: oura as never,
      whoop: null,
      googleHealth: null,
      vitronic: null,
    });
    for (const metric of oura.metrics) {
      expect(prompt.split(`[${metric.key}]`).length - 1).toBe(1);
    }
    expect(prompt).toContain("Oura wearable context for 2026-01-01 to 2026-01-02.");
    expect(prompt).toContain("### Available Oura keys");
  });
});
