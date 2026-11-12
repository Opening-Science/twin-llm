import { describe, expect, test } from "bun:test";

import type { OuraSummary } from "@/infrastructure/oura-types";
import { parseTwinAnswer } from "@/infrastructure/parse-twin-answer";
import type { WhoopSummary } from "@/infrastructure/whoop-types";

import { buildTwinSystemPrompt } from "./twin-system-prompt";
import { loadWearableContext } from "./wearable-context";

/** Synthetic summaries only (#464): Oura and WHOOP overlap on one day. */
const DAY = "2026-10-15";
const window = { startDate: "2026-10-09", endDate: DAY };

const oura: OuraSummary = {
  window,
  narrative: "Synthetic Oura window.",
  metrics: [
    {
      key: `sleep.hrv.long_sleep.${DAY}`,
      label: `Average HRV during sleep (${DAY})`,
      value: 52,
      unit: "ms",
      date: DAY,
    },
  ],
};

const whoop: WhoopSummary = {
  window,
  narrative: "Synthetic Whoop window.",
  metrics: [
    {
      key: `whoop.recovery.hrv.${DAY}`,
      label: `Whoop HRV RMSSD (${DAY})`,
      value: 61,
      unit: "ms",
      date: DAY,
    },
    {
      key: `whoop.recovery.spo2.${DAY}`,
      label: `Whoop SpO2 (${DAY})`,
      value: 95,
      unit: "%",
      date: DAY,
    },
  ],
};

const googleHealth = {
  window,
  narrative: "Synthetic Google Health window.",
  metrics: [
    {
      key: `google.daily-oxygen-saturation.${DAY}`,
      label: `Oxygen saturation (${DAY})`,
      value: 98,
      unit: "%",
      date: DAY,
    },
  ],
};

const context = () =>
  loadWearableContext("personal", "user-synthetic-1", {
    oura: async () => oura,
    whoop: async () => whoop,
    googleHealth: async () => googleHealth,
    vitronic: async () => null,
  });

const prompt = async () => {
  const wearables = await context();
  return buildTwinSystemPrompt({
    mode: "personal",
    oura: wearables.ouraSummary,
    whoop: wearables.whoopSummary,
    googleHealth: wearables.googleHealthSummary,
    vitronic: wearables.vitronicSummary,
  });
};

const EVIDENCE_LINE =
  "Sources disagree (WHOOP 61 ms). Oura is used: published validation grades it good for HRV (WHOOP no published grade).";

describe("source rules in the chat (#464)", () => {
  test("disagreement: only the reading used is offered, with its source rule", async () => {
    const text = await prompt();
    expect(text).toContain(
      `- [sleep.hrv.long_sleep.${DAY}] Average HRV during sleep (${DAY}): 52 ms (source rule: ${EVIDENCE_LINE})`,
    );
    expect(text).not.toContain(`[whoop.recovery.hrv.${DAY}]`);
  });

  test("no decision: the held-back readings are not offered, and the prompt says why", async () => {
    const text = await prompt();
    expect(text).not.toContain(`[whoop.recovery.spo2.${DAY}]`);
    expect(text).not.toContain(`[google.daily-oxygen-saturation.${DAY}]`);
    expect(text).toContain(
      `- ${DAY}: Held back: WHOOP and Google Health disagree on blood oxygen, and published validation grades them the same.`,
    );
    expect(text).not.toContain("95");
  });

  test("the cited value carries the rule; a held-back key is not an offered key", async () => {
    const wearables = await context();
    const parsed = parseTwinAnswer(
      [
        "## Reasoning",
        "Read the night.",
        "## Evidence Used",
        `- [sleep.hrv.long_sleep.${DAY}]`,
        `- [whoop.recovery.spo2.${DAY}]`,
        "## Answer",
        "HRV was 52 ms (Oura).",
      ].join("\n"),
      {
        oura: wearables.ouraSummary,
        whoop: wearables.whoopSummary,
        googleHealth: wearables.googleHealthSummary,
        vitronic: null,
      },
    );
    expect(parsed.attribution.map((item) => item.sourceRule)).toEqual([
      { kind: "evidence", line: EVIDENCE_LINE },
    ]);
    expect(parsed.hallucinatedKeys).toEqual([`whoop.recovery.spo2.${DAY}`]);
  });

  test("the decisions travel with the context for the audit row", async () => {
    expect((await context()).sourceDecisions?.map((decision) => decision.kind)).toEqual([
      "evidence",
      "held_back",
    ]);
  });

  test("agreement: no rules block when nothing overlaps", async () => {
    const text = buildTwinSystemPrompt({
      mode: "personal",
      oura,
      whoop: null,
      googleHealth: null,
      vitronic: null,
    });
    expect(text).not.toContain("## Where the wearable numbers come from");
  });
});
