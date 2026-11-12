import { describe, expect, test } from "bun:test";

import { judgeByEvidence } from "./open-twin-adapters/aggregate";
import { offeredKeys } from "./offered-keys";
import { heldBackNotes, resolveWearableSources } from "./wearable-source-resolve";

/** Synthetic summaries only; no person's data. */
const DAY = "2026-10-15";
const WINDOW = { startDate: "2026-10-09", endDate: DAY };

const oura = {
  window: WINDOW,
  narrative: "Synthetic Oura.",
  metrics: [
    {
      key: `sleep.hrv.long_sleep.${DAY}`,
      label: "HRV",
      value: 52,
      unit: "ms",
      date: DAY,
    },
    { key: `sleep.score.long_sleep.${DAY}`, label: "Sleep score", value: 80, date: DAY },
  ],
};

const whoop = {
  window: WINDOW,
  narrative: "Synthetic WHOOP.",
  metrics: [
    { key: `whoop.recovery.hrv.${DAY}`, label: "HRV", value: 61, unit: "ms", date: DAY },
    { key: `whoop.recovery.rhr.${DAY}`, label: "RHR", value: 52, unit: "bpm", date: DAY },
  ],
};

const googleHealth = {
  window: WINDOW,
  narrative: "Synthetic Google Health.",
  metrics: [
    {
      key: `google.daily-resting-heart-rate.${DAY}`,
      label: "RHR",
      value: 58,
      unit: "bpm",
      date: DAY,
    },
  ],
};

describe("resolveWearableSources", () => {
  const resolved = resolveWearableSources(
    { oura, whoop, googleHealth, vitronic: null },
    judgeByEvidence,
  );

  test("the reading used stays with its rule; the other and the held-back ones go", () => {
    expect(offeredKeys(resolved.summaries)).toEqual([
      `sleep.hrv.long_sleep.${DAY}`,
      `sleep.score.long_sleep.${DAY}`,
    ]);
    expect(resolved.summaries.oura?.metrics[0]?.sourceRule).toEqual({
      kind: "evidence",
      line: "Sources disagree (WHOOP 61 ms). Oura is used: published validation grades it good for HRV (WHOOP no published grade).",
    });
    expect(resolved.summaries.oura?.metrics[1]?.sourceRule).toBeUndefined();
  });

  test("a held-back measure is noted on every summary it came from, once overall", () => {
    expect(resolved.summaries.oura?.heldBack).toBeUndefined();
    expect(resolved.summaries.whoop?.heldBack?.map((note) => note.reason)).toEqual([
      "no_evidence",
    ]);
    expect(resolved.summaries.googleHealth?.heldBack?.map((note) => note.keys)).toEqual([
      [`whoop.recovery.rhr.${DAY}`, `google.daily-resting-heart-rate.${DAY}`],
    ]);
    expect(heldBackNotes(resolved.summaries).map((note) => note.measure)).toEqual([
      "resting-heart-rate",
    ]);
  });

  test("every decision is returned for the audit row", () => {
    expect(resolved.decisions.map((decision) => decision.kind)).toEqual([
      "evidence",
      "held_back",
    ]);
  });
});
