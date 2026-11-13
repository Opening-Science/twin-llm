import { describe, expect, test } from "bun:test";

import type { OuraTypedData } from "@open-twin/provider-oura";
import type { health_v4 } from "googleapis";

import {
  latestVitals,
  vitalRows,
} from "@/features/digital-twin/biomarkers/biomarker-rows";
import { buildOuraSummary } from "@/features/oura/summary";
import { buildWhoopSummary } from "@/features/whoop/summary";
import { buildGoogleHealthFhirBundle } from "@/infrastructure/open-twin-adapters/google-health";
import {
  heldBackNotes,
  resolveWearableSources,
} from "@/infrastructure/wearable-source-resolve";
import {
  decideSources,
  type SourceDecision,
} from "@/infrastructure/wearable-source-rules";

import { buildGoogleHealthSummary } from "./summary";

/**
 * The units each source really stores, end to end: Google Health readings go
 * through open-twin's pinned mapper and TwinLLM's summary, WHOOP and Oura
 * through their own summaries. Synthetic readings only; no person's data.
 */
const DAY = "2026-01-02";
const WINDOW = { startDate: DAY, endDate: DAY };
const DATE = { year: 2026, month: 1, day: 2 };

const GOOGLE_RESPONSES: health_v4.Schema$ListDataPointsResponse[] = [
  {
    dataPoints: [
      { dailyRestingHeartRate: { date: DATE, beatsPerMinute: "54" } },
      { dailyOxygenSaturation: { date: DATE, averagePercentage: 96 } },
      {
        dailyHeartRateVariability: {
          date: DATE,
          averageHeartRateVariabilityMilliseconds: 50,
        },
      },
      {
        steps: {
          interval: {
            startTime: `${DAY}T08:00:00Z`,
            startUtcOffset: "0s",
            endTime: `${DAY}T08:10:00Z`,
            endUtcOffset: "0s",
          },
          count: "8100",
        },
      },
    ],
  },
];

const SYNTHETIC_SUBJECT = "synthetic-wearer-1";

const googleSummary = buildGoogleHealthSummary(
  buildGoogleHealthFhirBundle(GOOGLE_RESPONSES, {
    subjectKey: SYNTHETIC_SUBJECT,
    timestamp: `${DAY}T12:00:00Z`,
  }),
  WINDOW,
);
const google = googleSummary.metrics;

const whoopSummary = buildWhoopSummary(
  {
    recovery: [
      {
        cycle_id: "2001",
        created_at: `${DAY}T07:00:00.000Z`,
        score_state: "SCORED",
        score: { resting_heart_rate: 52, hrv_rmssd_milli: 48.2, spo2_percentage: 96.4 },
      },
    ],
    cycles: [],
    sleep: [],
    workouts: [],
  },
  WINDOW,
);
const whoop = whoopSummary.metrics;

const OURA_DATA: readonly OuraTypedData[] = [
  {
    type: "sleep",
    data: {
      next_token: null,
      data: [
        {
          id: "sleep-synthetic-9",
          day: DAY,
          type: "long_sleep",
          bedtime_start: "2026-01-01T23:30:00+00:00",
          bedtime_end: `${DAY}T07:00:00+00:00`,
          average_hrv: 51,
        },
      ],
    },
  },
  {
    type: "daily_activity",
    data: {
      next_token: null,
      data: [
        {
          id: "activity-synthetic-9",
          day: DAY,
          timestamp: `${DAY}T00:00:00+00:00`,
          contributors: {},
          steps: 8000,
        },
      ],
    },
  },
];

const ouraSummary = buildOuraSummary(OURA_DATA, WINDOW);
const oura = ouraSummary.metrics;

const neverCalled = () => {
  throw new Error("agreeing readings never reach the evidence");
};

const decisionFor = (keys: readonly string[]): SourceDecision => {
  const metrics = [...google, ...whoop, ...oura].filter((metric) =>
    keys.includes(metric.key),
  );
  expect(metrics.map((metric) => metric.key).sort()).toEqual([...keys].sort());
  const decisions = decideSources(metrics, neverCalled);
  expect(decisions.length).toBe(1);
  return decisions[0]!;
};

const unitOf = (key: string): string | undefined =>
  [...google, ...whoop, ...oura].find((metric) => metric.key === key)?.unit;

describe("agreeing readings from different sources are compared, in the units they are stored in", () => {
  test("resting heart rate: Google's `per minute` and WHOOP's `bpm`", () => {
    expect(unitOf(`google.daily-resting-heart-rate.${DAY}`)).toBe("per minute");
    expect(unitOf(`whoop.recovery.rhr.${DAY}`)).toBe("bpm");
    const decision = decisionFor([
      `google.daily-resting-heart-rate.${DAY}`,
      `whoop.recovery.rhr.${DAY}`,
    ]);
    expect(decision).toMatchObject({ measure: "resting-heart-rate", kind: "agree" });
  });

  test("blood oxygen: Google's `%` and WHOOP's `%`", () => {
    expect(unitOf(`google.daily-oxygen-saturation.${DAY}`)).toBe("%");
    expect(unitOf(`whoop.recovery.spo2.${DAY}`)).toBe("%");
    const decision = decisionFor([
      `google.daily-oxygen-saturation.${DAY}`,
      `whoop.recovery.spo2.${DAY}`,
    ]);
    expect(decision).toMatchObject({ measure: "oxygen-saturation", kind: "agree" });
  });

  test("steps: Google's `steps` and Oura's reading without a unit", () => {
    expect(unitOf(`google.steps.${DAY}`)).toBe("steps");
    expect(unitOf(`activity.steps.${DAY}`)).toBeUndefined();
    const decision = decisionFor([`google.steps.${DAY}`, `activity.steps.${DAY}`]);
    expect(decision).toMatchObject({ measure: "step-count", kind: "agree" });
  });

  test("HRV: Oura's and WHOOP's `ms`; Google's daily HRV has no top-level value to store", () => {
    expect(unitOf(`sleep.hrv.long_sleep.${DAY}`)).toBe("ms");
    expect(unitOf(`whoop.recovery.hrv.${DAY}`)).toBe("ms");
    expect(google.some((metric) => metric.key.includes("heart-rate-variability"))).toBe(
      false,
    );
    const decision = decisionFor([
      `sleep.hrv.long_sleep.${DAY}`,
      `whoop.recovery.hrv.${DAY}`,
    ]);
    expect(decision).toMatchObject({ measure: "heart-rate-variability", kind: "agree" });
  });
});

describe("the Digital Twin vitals after the rules", () => {
  const { summaries } = resolveWearableSources(
    {
      oura: ouraSummary,
      whoop: whoopSummary,
      googleHealth: googleSummary,
      vitronic: null,
    },
    neverCalled,
  );
  const metrics = [
    ...(summaries.oura?.metrics ?? []),
    ...(summaries.whoop?.metrics ?? []),
    ...(summaries.googleHealth?.metrics ?? []),
  ];
  const rows = vitalRows(latestVitals(metrics, heldBackNotes(summaries)));

  test("nothing is held back, and resting heart rate shows a value with Sources agree", () => {
    expect(heldBackNotes(summaries)).toEqual([]);
    const rhr = rows.find((row) => row.id === "vital:rhr");
    expect(rhr?.value).toBe("52 bpm");
    expect(rhr?.sourceStatus).toMatchObject({ tone: "ok", label: "Sources agree" });
  });
});
