import { describe, expect, test } from "bun:test";

import { INSIGHT_METRIC_BY_STEM } from "../insight";
import { kitSections, SOURCE_SERIES, type KitCard } from "../kit-cards";
import type { Metric } from "../metric-utils";
import type { WearableDetail } from "../wearable-detail";
import {
  accuracyDevice,
  cardAccuracy,
  cardStems,
  MEASURE_BY_STEM,
} from "./card-accuracy";

/** Made-up daily readings ending 7 Nov 2026. */
const series = (stem: string, value: number): Metric[] =>
  Array.from({ length: 40 }, (_, i) => {
    const date = new Date(Date.UTC(2026, 10, 7 - i)).toISOString().slice(0, 10);
    return { key: `${stem}.${date}`, label: stem, value: value + (i % 3), date };
  });

const TODAY = "2026-11-08";

const METRICS: readonly Metric[] = [
  ...series("readiness.score", 80),
  ...series("sleep.score", 75),
  ...series("activity.score", 70),
  ...series("sleep.hr.long_sleep", 56),
  ...series("sleep.hrv.long_sleep", 42),
  ...series("sleep.duration.long_sleep", 450),
  ...series("sleep.efficiency.long_sleep", 90),
  ...series("activity.steps", 8000),
  ...series("whoop.recovery.score", 60),
  ...series("whoop.sleep.performance", 85),
  ...series("whoop.recovery.rhr", 55),
  ...series("whoop.recovery.hrv", 60),
  ...series("whoop.recovery.spo2", 96),
  ...series("whoop.sleep.in_bed_min", 470),
  ...series("google.daily-resting-heart-rate", 58),
  ...series("google.daily-heart-rate-variability", 38),
  ...series("google.steps", 9000),
  ...series("google.active-minutes", 40),
  ...series("google.daily-oxygen-saturation", 97),
];

const NIGHTS = Array.from({ length: 14 }, (_, i) => ({
  day: new Date(Date.UTC(2026, 10, 7 - 13 + i)).toISOString().slice(0, 10),
  bedtime: 300,
  asleep: 450,
}));

const DETAIL: WearableDetail = {
  steps: {
    status: "ok",
    day: TODAY,
    hourly: Array.from({ length: 24 }, (_, h) => h * 300),
    usual: Array.from({ length: 24 }, (_, h) => h * 250),
    usualDays: 14,
  },
  night: {
    status: "ok",
    day: "2026-11-07",
    segments: [
      { stage: "core", start: 300, end: 330 },
      { stage: "deep", start: 330, end: 400 },
    ],
  },
  nights: { status: "ok", nights: NIGHTS },
};

const cards = (source: "oura" | "whoop" | "google-health"): readonly KitCard[] =>
  kitSections({ source, metrics: METRICS, today: TODAY, detail: DETAIL }).flatMap(
    (s) => s.cards,
  );

/** One line per card: its id, then device and each note's measure and evidence level. */
const table = (source: "oura" | "whoop" | "google-health") =>
  cards(source).map((card) => {
    const accuracy = cardAccuracy(source, card);
    if (!accuracy) return `${card.id} -> none`;
    const notes = accuracy.entries.map(
      (e) => `${e.part ? `${e.part}=` : ""}${e.measure}/${e.evidence}`,
    );
    return `${card.id} -> ${accuracy.device}: ${notes.join(", ")}`;
  });

describe("cardAccuracy, every dashboard card", () => {
  test("Oura", () => {
    expect(table("oura")).toEqual([
      "ring:readiness.score. -> oura: compositeScores/none",
      "ring:sleep.score. -> oura: compositeScores/none",
      "ring:activity.score. -> none",
      "nights:sleep.duration. -> oura: totalSleepTime/validated",
      "night:stages -> oura: sleepStages/limited",
      "daily:activity.steps. -> none",
      "daily:sleep.hr. -> oura: restingHeartRate/validated",
      "daily:sleep.hrv. -> oura: hrv/validated",
      "radar:Night: Against usual -> oura: HRV=hrv/validated, During sleep=restingHeartRate/validated, Duration=totalSleepTime/validated",
      "weekly:activity.steps. -> none",
      "weekly:sleep.duration. -> oura: totalSleepTime/validated",
      "weekly:sleep.hrv. -> oura: hrv/validated",
      "weekly:sleep.hr. -> oura: restingHeartRate/validated",
      "nights:bedtime -> none",
      "month:activity.steps. -> none",
      "month:sleep.duration. -> oura: totalSleepTime/validated",
      "month:sleep.hrv. -> oura: hrv/validated",
      "weeks:sleep.hr. -> oura: restingHeartRate/validated",
      "month:readiness.score. -> oura: compositeScores/none",
    ]);
  });

  test("WHOOP", () => {
    expect(table("whoop")).toEqual([
      "ring:whoop.recovery.score. -> whoop: compositeScores/none",
      "ring:whoop.sleep.performance. -> none",
      "nights:whoop.sleep.in_bed_min. -> whoop: totalSleepTime/validated",
      "daily:whoop.recovery.rhr. -> whoop: restingHeartRate/validated",
      "daily:whoop.recovery.hrv. -> whoop: hrv/validated",
      "radar:Recovery: Against usual -> whoop: HRV=hrv/validated, Resting=restingHeartRate/validated, SpO2=spo2/none",
      "weekly:whoop.sleep.in_bed_min. -> whoop: totalSleepTime/validated",
      "weekly:whoop.recovery.hrv. -> whoop: hrv/validated",
      "weekly:whoop.recovery.rhr. -> whoop: restingHeartRate/validated",
      "nights:bedtime -> none",
      "month:whoop.sleep.in_bed_min. -> whoop: totalSleepTime/validated",
      "month:whoop.recovery.hrv. -> whoop: hrv/validated",
      "weeks:whoop.recovery.rhr. -> whoop: restingHeartRate/validated",
      "month:whoop.recovery.score. -> whoop: compositeScores/none",
    ]);
  });

  test("Google Health takes the Fitbit notes", () => {
    expect(table("google-health")).toEqual([
      "night:stages -> fitbit: sleepStages/validated",
      "day:steps -> none",
      "daily:google.steps. -> none",
      "daily:google.daily-resting-heart-rate. -> fitbit: restingHeartRate/limited",
      "daily:google.daily-heart-rate-variability. -> fitbit: hrv/none",
      "radar:Day: Against usual -> fitbit: HRV=hrv/none, Resting=restingHeartRate/limited, SpO2=spo2/limited",
      "weekly:google.steps. -> none",
      "weekly:google.daily-heart-rate-variability. -> fitbit: hrv/none",
      "weekly:google.daily-resting-heart-rate. -> fitbit: restingHeartRate/limited",
      "nights:bedtime -> none",
      "month:google.steps. -> none",
      "month:google.daily-heart-rate-variability. -> fitbit: hrv/none",
      "weeks:google.daily-resting-heart-rate. -> fitbit: restingHeartRate/limited",
    ]);
  });

  test("every series a card draws, and every insight stem, has a row in the table", () => {
    const stems = (["oura", "whoop", "google-health"] as const).flatMap((source) =>
      cards(source).flatMap((card) => cardStems(source, card).map((s) => s.stem)),
    );
    const seriesStems = Object.values(SOURCE_SERIES).flatMap((s) =>
      [s.heart, s.hrv, s.sleep, s.steps, ...s.scores, ...s.radar.parts].flatMap((x) =>
        x ? [x.prefix.replace(/\.$/, "")] : [],
      ),
    );
    const missing = [...stems, ...seriesStems, ...Object.keys(INSIGHT_METRIC_BY_STEM)]
      .filter((stem) => !(stem in MEASURE_BY_STEM))
      .sort();
    expect(missing).toEqual([]);
  });

  test("a loading card and an empty section card get no note", () => {
    const loading = kitSections({
      source: "oura",
      metrics: [],
      today: TODAY,
      detail: "loading",
    }).flatMap((s) => s.cards);
    expect(loading.map((card) => cardAccuracy("oura", card))).toEqual(
      loading.map(() => null),
    );
  });
});

describe("cardAccuracy, what a note says", () => {
  const find = (source: "oura" | "whoop" | "google-health", id: string) =>
    cardAccuracy(
      source,
      cards(source).find((c) => c.id === id)!,
    )!;

  test("a composite score says no validation was found", () => {
    const readiness = find("oura", "ring:readiness.score.");
    expect(readiness.entries[0]!.note).toBe(
      "This review found no published validation of Oura Readiness or Sleep Score against a reference measure or health outcome.",
    );
    expect(readiness.entries[0]!.sources).toEqual([]);
  });

  test("a near measure says which one was studied", () => {
    expect(find("oura", "daily:sleep.hr.").entries[0]!.remark).toBe(
      "This card shows average heart rate during sleep. The note is about nightly resting heart rate, the closest measure reviewed.",
    );
    expect(find("whoop", "nights:whoop.sleep.in_bed_min.").entries[0]!.remark).toBe(
      "This card shows time in bed. The note is about total sleep time, the closest measure reviewed.",
    );
    expect(find("whoop", "daily:whoop.recovery.hrv.").entries[0]!.remark).toBeNull();
  });

  test("vendor funding comes with the note, and each paper once with its DOI link", () => {
    const sleep = find("oura", "nights:sleep.duration.").entries[0]!;
    expect(sleep.funding).toBe("Both studies were funded or supported by Oura.");
    expect(sleep.sources.map((s) => `${s.id} ${s.href}`)).toEqual([
      "robbins-2024 https://doi.org/10.3390/s24206532",
      "svensson-2024 https://doi.org/10.1016/j.sleep.2024.01.020",
    ]);
    expect(find("oura", "daily:sleep.hrv.").entries[0]!.funding).toBeNull();
  });

  test("Google Health names the device family it falls back to", () => {
    expect(
      find("google-health", "daily:google.daily-resting-heart-rate.").deviceRemark,
    ).toBe(
      "Google Health does not say which device recorded this, so this is the note for Fitbit, the closest device family.",
    );
    expect(find("oura", "daily:sleep.hrv.").deviceRemark).toBeNull();
  });

  test("a known device model picks its family and is named", () => {
    expect(accuracyDevice("google-health", "Pixel Watch 2")).toEqual({
      device: "pixel-watch",
      remark: "Recorded by a Pixel Watch 2; this is the note for Google Pixel Watch.",
    });
    expect(accuracyDevice("google-health", "Fitbit Charge 6")).toEqual({
      device: "fitbit",
      remark: "Recorded by a Fitbit Charge 6; this is the note for Fitbit.",
    });
    expect(accuracyDevice("whoop", "anything")).toEqual({ device: "whoop" });
  });
});
