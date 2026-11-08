import { describe, expect, test } from "bun:test";

import { buildBundleFromResponses } from "@open-twin/provider-google-health";

import { SYNTHETIC_GOOGLE_HEALTH_RESPONSES } from "@/features/google-health/fixtures/synthetic-sync-responses";
import { SYNTHETIC_OURA_SLEEP } from "@/features/oura/fixtures/synthetic-sync-data";
import { SYNTHETIC_WHOOP_PAYLOAD } from "@/features/whoop/fixtures/synthetic-sync-payload";
import { buildOuraFhirBundle } from "@/infrastructure/open-twin-adapters/oura";
import { buildWhoopFhirBundle } from "@/infrastructure/open-twin-adapters/whoop";

import { localClock } from "./local-clock";
import {
  cumulative,
  detailRowCount,
  hourBuckets,
  meanCurve,
  ouraStages,
  stepsDetail,
  wearableDetail,
  type DetailOptions,
} from "./wearable-detail";

const SUBJECT = "synthetic-wearer-1";

const ouraBundle = buildOuraFhirBundle(
  [SYNTHETIC_OURA_SLEEP],
  { types: ["sleep"], start_date: "2026-01-01", end_date: "2026-01-04" },
  { subjectKey: SUBJECT, timestamp: "2026-01-05T00:00:00Z" },
);
const whoopBundle = buildWhoopFhirBundle(SYNTHETIC_WHOOP_PAYLOAD, {
  subjectKey: SUBJECT,
  timestamp: "2026-01-05T00:00:00Z",
});
const googleBundle = buildBundleFromResponses(SYNTHETIC_GOOGLE_HEALTH_RESPONSES, {
  subjectKey: SUBJECT,
  timestamp: "2026-01-09T00:00:00Z",
}).bundle;

const options = (over: Partial<DetailOptions>): DetailOptions => ({
  source: "oura",
  startDate: "2026-01-01",
  endDate: "2026-01-31",
  timeZone: "UTC",
  ...over,
});

/** The 14 nights ending on `last`, with only the named ones filled. */
const nights = (
  last: string,
  filled: Readonly<Record<string, { bedtime: number; asleep: number | null }>>,
) =>
  Array.from({ length: 14 }, (_, i) => {
    const day = new Date(Date.parse(`${last}T00:00:00Z`) - (13 - i) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    return { day, ...(filled[day] ?? { bedtime: null, asleep: null }) };
  });

const sample = (iso: string, count: number, zone = "UTC") => ({
  clock: localClock(iso, zone)!,
  count,
});

describe("hour buckets and running totals", () => {
  test("steps go to the local hour they start in, per day", () => {
    const buckets = hourBuckets([
      sample("2026-01-01T08:05:00+01:00", 100),
      sample("2026-01-01T08:55:00+01:00", 50),
      sample("2026-01-01T23:59:00+01:00", 7),
      // 23:30 UTC is already the next day in Zurich.
      sample("2026-01-01T23:30:00Z", 9, "Europe/Zurich"),
    ]);
    expect([...buckets.keys()]).toEqual(["2026-01-01", "2026-01-02"]);
    expect(buckets.get("2026-01-01")![8]).toBe(150);
    expect(buckets.get("2026-01-01")![23]).toBe(7);
    expect(buckets.get("2026-01-02")![0]).toBe(9);
  });

  test("the autumn change puts both 2 AM hours in one bucket; spring skips 2 AM", () => {
    const autumn = hourBuckets([
      sample("2026-10-25T00:30:00Z", 10, "Europe/Zurich"),
      sample("2026-10-25T01:30:00Z", 20, "Europe/Zurich"),
    ]).get("2026-10-25")!;
    expect(autumn[2]).toBe(30);
    const spring = hourBuckets([
      sample("2026-03-29T00:30:00Z", 10, "Europe/Zurich"),
      sample("2026-03-29T01:30:00Z", 20, "Europe/Zurich"),
    ]).get("2026-03-29")!;
    expect([spring[1], spring[2], spring[3]]).toEqual([10, 0, 20]);
    expect(cumulative(spring).slice(0, 5)).toEqual([0, 10, 10, 30, 30]);
  });

  test("a running total never falls, and the mean curve is per hour", () => {
    expect(cumulative([1, 0, 2, 3])).toEqual([1, 1, 3, 6]);
    const day = (n: number) => Array.from({ length: 24 }, (_, h) => n * (h + 1));
    expect(meanCurve([day(1), day(2)])!.slice(0, 3)).toEqual([2, 3, 5]);
    expect(meanCurve([])).toBeNull();
  });

  test("a usual day needs 7 earlier days and uses at most 14", () => {
    const days = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        sample(`2026-01-${String(i + 1).padStart(2, "0")}T09:00:00+01:00`, 100 * (i + 1)),
      );
    const six = stepsDetail(days(7), options({}));
    expect(six).toMatchObject({ status: "ok", day: "2026-01-07", usualDays: 6 });
    expect(six.status === "ok" && six.usual).toBeNull();
    const twenty = stepsDetail(days(20), options({}));
    expect(twenty).toMatchObject({ status: "ok", day: "2026-01-20", usualDays: 14 });
    // Days 6 to 19 make the usual: a mean of 600 to 1,900 is 1,250 from 9 AM.
    expect(twenty.status === "ok" && twenty.usual?.slice(8, 10)).toEqual([0, 1_250]);
  });

  test("only days inside the window count", () => {
    expect(
      stepsDetail(
        [sample("2026-02-03T09:00:00+01:00", 10)],
        options({ endDate: "2026-01-31" }),
      ),
    ).toEqual({ status: "missing" });
  });
});

describe("Oura", () => {
  test("a hypnogram string becomes one block per run, 5 minutes per character", () => {
    expect(ouraStages("4422x1", 0)).toEqual([
      { stage: "awake", startMs: 0, endMs: 600_000 },
      { stage: "core", startMs: 600_000, endMs: 1_200_000 },
      { stage: "deep", startMs: 1_500_000, endMs: 1_800_000 },
    ]);
  });

  test("last night's stages, after 6 PM, and its bedtime against the 13 before", () => {
    const detail = wearableDetail(
      ouraBundle,
      options({ endDate: "2026-01-02", timeZone: "Asia/Tokyo" }),
    );
    expect(detail).toEqual({
      steps: { status: "not-provided" },
      night: {
        status: "ok",
        day: "2026-01-02",
        // 11:40 PM is 340 minutes after 6 PM.
        segments: [
          { stage: "awake", start: 340, end: 350 },
          { stage: "core", start: 350, end: 370 },
          { stage: "deep", start: 370, end: 385 },
          { stage: "rem", start: 385, end: 395 },
          { stage: "awake", start: 395, end: 400 },
        ],
      },
      nights: {
        status: "ok",
        nights: nights("2026-01-02", { "2026-01-02": { bedtime: 340, asleep: 415 } }),
      },
    });
    expect(detailRowCount(detail)).toBe(2);
  });

  test("a night without a hypnogram has no stages; a nap is not the night's sleep", () => {
    const detail = wearableDetail(ouraBundle, options({ endDate: "2026-01-04" }));
    expect(detail.night).toEqual({ status: "missing" });
    expect(detail.nights).toEqual({
      status: "ok",
      nights: nights("2026-01-03", {
        "2026-01-02": { bedtime: 340, asleep: 415 },
        // 00:25 is 385 minutes after 6 PM; the 2 PM nap is shorter.
        "2026-01-03": { bedtime: 385, asleep: 390 },
      }),
    });
  });
});

describe("WHOOP", () => {
  test("bedtimes on the viewer's zone, stages as totals only, no steps", () => {
    const detail = wearableDetail(
      whoopBundle,
      options({ source: "whoop", timeZone: "Europe/Zurich" }),
    );
    expect(detail).toEqual({
      steps: { status: "not-provided" },
      night: { status: "totals-only" },
      nights: {
        status: "ok",
        // 23:10 UTC is 00:10 in Zurich: 370 minutes after 6 PM, the night of 2 Jan.
        nights: nights("2026-01-02", { "2026-01-02": { bedtime: 370, asleep: null } }),
      },
    });
  });

  test("with nothing in the window, every chart is missing", () => {
    const detail = wearableDetail(
      whoopBundle,
      options({ source: "whoop", startDate: "2026-02-01", endDate: "2026-02-28" }),
    );
    expect(detail).toEqual({
      steps: { status: "not-provided" },
      night: { status: "missing" },
      nights: { status: "missing" },
    });
    expect(detailRowCount(detail)).toBe(0);
  });
});

describe("Google Health", () => {
  const detail = wearableDetail(googleBundle, options({ source: "google-health" }));

  test("steps through the latest day by the hour, against the 7 days before", () => {
    const flat = (until8: number, until12: number, rest: number) =>
      Array.from({ length: 24 }, (_, h) =>
        h < 8 ? 0 : h < 12 ? until8 : h < 18 ? until12 : rest,
      );
    expect(detail.steps).toEqual({
      status: "ok",
      day: "2026-01-08",
      hourly: flat(1_500, 2_000, 2_000),
      usual: flat(1_000, 3_000, 6_000),
      usualDays: 7,
    });
  });

  test("stage blocks come back in time order, whatever order they were sent in", () => {
    expect(detail.night).toEqual({
      status: "ok",
      day: "2026-01-08",
      segments: [
        { stage: "core", start: 330, end: 360 },
        { stage: "deep", start: 360, end: 370 },
        { stage: "rem", start: 370, end: 400 },
        { stage: "awake", start: 400, end: 405 },
        { stage: "core", start: 405, end: 780 },
      ],
    });
    expect(detail.nights).toEqual({
      status: "ok",
      nights: nights("2026-01-08", { "2026-01-08": { bedtime: 330, asleep: 445 } }),
    });
    expect(detailRowCount(detail)).toBe(3);
  });

  test("nothing in it carries a timestamp, an offset or a record id", () => {
    const text = JSON.stringify(detail);
    expect(text).not.toMatch(/T\d{2}:\d{2}|Z"|\+01:00|users\/|synthetic-wearer/);
  });
});

describe("no bundle", () => {
  test("is missing everywhere, not an error", () => {
    expect(wearableDetail(null, options({ source: "google-health" }))).toEqual({
      steps: { status: "missing" },
      night: { status: "missing" },
      nights: { status: "missing" },
    });
  });
});
