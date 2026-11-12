import { describe, expect, test } from "bun:test";

import { judgeByEvidence } from "./open-twin-adapters/aggregate";
import { summarySources, wearableSourcesEvent } from "./wearable-source-audit";
import { decideSources } from "./wearable-source-rules";

/** Synthetic readings only; no person's data. */
const DAY = "2026-10-15";

const decisions = decideSources(
  [
    { key: `sleep.hrv.long_sleep.${DAY}`, value: 52, unit: "ms", date: DAY },
    { key: `whoop.recovery.hrv.${DAY}`, value: 61, unit: "ms", date: DAY },
    { key: `whoop.recovery.rhr.${DAY}`, value: 52, unit: "bpm", date: DAY },
    { key: `google.daily-resting-heart-rate.${DAY}`, value: 58, unit: "bpm", date: DAY },
    { key: `activity.steps.${DAY}`, value: 8000, date: DAY },
    { key: `google.steps.${DAY}`, value: 8100, unit: "steps", date: DAY },
  ],
  judgeByEvidence,
);

describe("wearableSourcesEvent", () => {
  test("names every source, and per measure the outcome and sources; no value or day", () => {
    const event = wearableSourcesEvent({
      actor: "user_synthetic_1",
      sessionId: "turn-synthetic-1",
      sources: ["google_health", "whoop", "oura"],
      decisions,
    });
    expect(event).toEqual({
      actor: "user_synthetic_1",
      sessionId: "turn-synthetic-1",
      subjectRef: null,
      tool: "wearable.sources.oura+whoop+google_health",
      args: {
        rules: "wearable-source-rules/1",
        decisions: [
          {
            measure: "heart-rate-variability",
            outcome: "evidence",
            used: "oura",
            others: ["whoop"],
            reason: null,
          },
          {
            measure: "resting-heart-rate",
            outcome: "held_back",
            used: null,
            others: ["whoop", "google_health"],
            reason: "no_evidence",
          },
          {
            measure: "step-count",
            outcome: "agree",
            used: "oura",
            others: ["google_health"],
            reason: null,
          },
        ],
      },
      result: { only_source: 0, agree: 1, evidence: 1, held_back: 1 },
      rowCount: 3,
    });
    const blob = JSON.stringify(event);
    expect(blob).not.toContain(DAY);
    expect(blob).not.toContain("52");
    expect(blob).not.toContain("bpm");
  });

  test("a single source is still recorded; no source writes nothing", () => {
    expect(
      wearableSourcesEvent({
        actor: "a",
        sessionId: "s",
        sources: ["whoop"],
        decisions: [],
      })?.tool,
    ).toBe("wearable.sources.whoop");
    expect(
      wearableSourcesEvent({ actor: "a", sessionId: "s", sources: [], decisions: [] }),
    ).toBeNull();
  });

  test("summarySources reads which summaries are there, in a fixed order", () => {
    expect(
      summarySources({ oura: null, whoop: {}, googleHealth: undefined, vitronic: {} }),
    ).toEqual(["whoop", "bodyloop"]);
  });
});
