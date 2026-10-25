import { describe, expect, test } from "bun:test";

import {
  cohortLiveVitals,
  COHORT_VITAL_LOINCS,
  dailyValues,
  hrvBelowUsual,
  HRV_MIN_DAYS,
  HRV_WINDOW_DAYS,
  metricSource,
  NO_LIVE_VITALS,
  vitalSeries,
  wearableLiveVitals,
} from "./live-rates";

/** Synthetic cohort rows, as the cohort route returns them. */
const row = (loinc: string, value: number, unitUcum = "/min") => ({
  loinc,
  value,
  unitUcum,
  effectiveAt: "2025-03-01T08:00:00.000Z",
});

const UNIT: Readonly<Record<string, string>> = {
  "sleep.hr": "bpm",
  "sleep.hrv": "ms",
  "whoop.cycle.avg_hr": "bpm",
  "whoop.recovery.rhr": "bpm",
  "whoop.recovery.hrv": "ms",
  "google.heart-rate": "per minute",
  "google.daily-respiratory-rate": "per minute",
};

/** A synthetic stored metric, dated in its key and unitised as its source stores it. */
const metric = (stem: string, day: string, value: number, unit = UNIT[stem]) => ({
  key: `${stem}.${day}`,
  value,
  unit,
});

/** `n` days back from 18 Oct 2026, as ISO days. */
const daysBefore = (n: number): string =>
  new Date(Date.UTC(2026, 9, 18 - n)).toISOString().slice(0, 10);

describe("cohort rates (the Demo)", () => {
  test("the codes are heart rate and respiratory rate", () => {
    expect(COHORT_VITAL_LOINCS).toEqual({ heartRate: "8867-4", respiration: "9279-1" });
  });

  test("heart and breathing from the person's newest rows; the cohort has no HRV", () => {
    expect(
      cohortLiveVitals([row("8867-4", 72), row("9279-1", 14)], "Synthetic person 3"),
    ).toEqual({
      heart: {
        perMinute: 72,
        day: "2025-03-01",
        source: "Synthetic person 3",
        vital: "heartRate",
      },
      breath: {
        perMinute: 14,
        day: "2025-03-01",
        source: "Synthetic person 3",
        vital: "respiration",
      },
      hrvBelow: null,
    });
  });

  test("a missing, wrongly unitised or implausible row gives no rate, never a made-up one", () => {
    expect(cohortLiveVitals([row("8867-4", 72, "Hz")], "P")).toEqual(NO_LIVE_VITALS);
    expect(cohortLiveVitals([row("8867-4", 0), row("9279-1", 90)], "P")).toEqual(
      NO_LIVE_VITALS,
    );
    expect(cohortLiveVitals([], "P")).toEqual(NO_LIVE_VITALS);
    expect(cohortLiveVitals(null, "P")).toEqual(NO_LIVE_VITALS);
  });
});

describe("wearable rates (Self, synthetic objects only)", () => {
  test("vendor from the stem prefix", () => {
    expect(metricSource("whoop.recovery.rhr")).toBe("Whoop");
    expect(metricSource("google.daily-respiratory-rate")).toBe("Google Health");
    expect(metricSource("sleep.hr")).toBe("Oura");
  });

  test("the newest heart rate from the first source with data, and breathing", () => {
    const metrics = [
      metric("sleep.hr", "2026-10-17", 58),
      metric("sleep.hr", "2026-10-18", 61),
      metric("whoop.cycle.avg_hr", "2026-10-19", 70),
      metric("google.daily-respiratory-rate", "2026-10-16", 15.5),
    ];
    expect(wearableLiveVitals(metrics)).toEqual({
      heart: { perMinute: 61, day: "2026-10-18", source: "Oura", vital: "heartRate" },
      breath: {
        perMinute: 15.5,
        day: "2026-10-16",
        source: "Google Health",
        vital: "respiration",
      },
      hrvBelow: null,
    });
  });

  test("resting heart rate when there is no heart rate; no breathing without a source", () => {
    expect(wearableLiveVitals([metric("whoop.recovery.rhr", "2026-10-18", 52)])).toEqual({
      heart: { perMinute: 52, day: "2026-10-18", source: "Whoop", vital: "rhr" },
      breath: null,
      hrvBelow: null,
    });
    expect(wearableLiveVitals([])).toEqual(NO_LIVE_VITALS);
  });

  test("an undated row is skipped, never read as the newest day", () => {
    // Whoop writes "unknown" for a row without a timestamp; it must not sort first.
    const metrics = [
      { key: "whoop.recovery.rhr.unknown", value: 49, unit: "bpm", date: "unknown" },
      metric("whoop.recovery.rhr", "2026-10-12", 55),
    ];
    expect(wearableLiveVitals(metrics).heart).toEqual({
      perMinute: 55,
      day: "2026-10-12",
      source: "Whoop",
      vital: "rhr",
    });
    expect(
      wearableLiveVitals([
        { key: "whoop.recovery.rhr.unknown", value: 49, unit: "bpm", date: "unknown" },
      ]).heart,
    ).toBeNull();
  });

  test("on one day the night's reading wins over a nap, whatever order the API gives", () => {
    const nap = { key: "sleep.hr.nap.2026-10-18", value: 70, unit: "bpm" };
    const night = { key: "sleep.hr.long_sleep.2026-10-18", value: 56, unit: "bpm" };
    expect(wearableLiveVitals([nap, night]).heart?.perMinute).toBe(56);
    expect(wearableLiveVitals([night, nap]).heart?.perMinute).toBe(56);
  });

  test("without a night reading the day's mean, and the key breaks a tie", () => {
    const a = { key: "sleep.hr.nap.2026-10-18", value: 70, unit: "bpm" };
    const b = { key: "sleep.hr.rest.2026-10-18", value: 60, unit: "bpm" };
    expect(wearableLiveVitals([a, b]).heart?.perMinute).toBe(65);
    expect(wearableLiveVitals([b, a]).heart?.perMinute).toBe(65);
    const nights = [
      { key: "sleep.hr.long_sleep.b.2026-10-18", value: 58, unit: "bpm" },
      { key: "sleep.hr.long_sleep.a.2026-10-18", value: 54, unit: "bpm" },
    ];
    expect(
      dailyValues(
        nights.map((n) => ({
          day: "2026-10-18",
          value: n.value,
          source: "Oura",
          key: n.key,
        })),
      )[0]?.value,
    ).toBe(54);
  });

  test("units must match exactly; Google Health's FHIR display unit counts", () => {
    expect(
      wearableLiveVitals([metric("sleep.hr", "2026-10-18", 61, "Hz")]).heart,
    ).toBeNull();
    expect(wearableLiveVitals([{ key: "sleep.hr.2026-10-18", value: 61 }]).heart).toBe(
      null,
    );
    expect(
      wearableLiveVitals([metric("google.heart-rate", "2026-10-18", 64)]).heart,
    ).toEqual({
      perMinute: 64,
      day: "2026-10-18",
      source: "Google Health",
      vital: "heartRate",
    });
    expect(
      wearableLiveVitals([
        metric("google.daily-respiratory-rate", "2026-10-18", 14, "breaths"),
      ]).breath,
    ).toBeNull();
    expect(
      vitalSeries([metric("whoop.recovery.hrv", "2026-10-18", 41, "s")], "hrv", "hrv"),
    ).toEqual([]);
  });

  test("zero, negative and implausible values are dropped", () => {
    for (const value of [0, -60, 400]) {
      expect(
        wearableLiveVitals([metric("sleep.hr", "2026-10-18", value)]).heart,
      ).toBeNull();
    }
    for (const value of [0, 0.5, 301]) {
      expect(
        vitalSeries([metric("sleep.hrv", "2026-10-18", value)], "hrv", "hrv"),
      ).toEqual([]);
    }
    expect(vitalSeries([metric("sleep.hrv", "2026-10-18", 300)], "hrv", "hrv")).toEqual([
      { day: "2026-10-18", value: 300, source: "Oura", key: "sleep.hrv.2026-10-18" },
    ]);
  });

  test("a sleep period in the key still reads as that day", () => {
    expect(
      vitalSeries(
        [{ key: "sleep.hrv.long_sleep.2026-10-18", value: "44", unit: "ms" }],
        "hrv",
        "hrv",
      ),
    ).toEqual([
      {
        day: "2026-10-18",
        value: 44,
        source: "Oura",
        key: "sleep.hrv.long_sleep.2026-10-18",
      },
    ]);
  });
});

describe("HRV below this person's usual level", () => {
  const point = (n: number, value: number) => ({
    day: daysBefore(n),
    value,
    source: "Oura",
    key: `sleep.hrv.${daysBefore(n)}`,
  });
  const usualDays = (count: number, value = 50) =>
    Array.from({ length: count }, (_, i) => point(i + 1, value));
  const today = (value: number) => point(0, value);

  test("the rule's numbers", () => {
    expect([HRV_WINDOW_DAYS, HRV_MIN_DAYS]).toEqual([28, 14]);
  });

  test("20% or more below the 28-day median glows; less does not, exactly at the edge", () => {
    expect(hrvBelowUsual([today(38), ...usualDays(28)])).toEqual({
      latest: 38,
      median: 50,
      day: "2026-10-18",
      source: "Oura",
    });
    // 40 is exactly 20% under 50: latest × 5 = usual × 4.
    expect(hrvBelowUsual([today(40), ...usualDays(28)])?.latest).toBe(40);
    expect(hrvBelowUsual([today(40.001), ...usualDays(28)])).toBeNull();
    // A median whose 80% is not exact in binary still decides the edge exactly.
    expect(hrvBelowUsual([today(5.6), ...usualDays(14, 7)])?.latest).toBe(5.6);
  });

  test("fewer than 14 days of history is no glow", () => {
    expect(hrvBelowUsual([today(30), ...usualDays(13)])).toBeNull();
    expect(hrvBelowUsual([today(30), ...usualDays(14)])?.median).toBe(50);
  });

  test("day 28 is in the window, day 29 is not", () => {
    // 13 days of 40 plus day 28 makes 14: inside, so it glows against 40.
    const thirteen = Array.from({ length: 13 }, (_, i) => point(i + 1, 40));
    expect(hrvBelowUsual([today(30), ...thirteen, point(28, 40)])?.median).toBe(40);
    expect(hrvBelowUsual([today(30), ...thirteen, point(29, 40)])).toBeNull();
  });

  test("older days never count", () => {
    const old = Array.from({ length: 20 }, (_, i) => point(29 + i, 100));
    expect(hrvBelowUsual([today(30), ...usualDays(14, 40), ...old])?.median).toBe(40);
    expect(hrvBelowUsual([today(30), ...usualDays(10, 40), ...old])).toBeNull();
  });

  test("an even count takes the mean of the two distinct middle values", () => {
    // 14 days valued 40, 41, … 53: the middle two are 46 and 47.
    const days = Array.from({ length: 14 }, (_, i) => point(i + 1, 40 + i));
    expect(hrvBelowUsual([today(30), ...days])?.median).toBe(46.5);
  });

  test("the median, not the mean", () => {
    const skewed = [...usualDays(13, 50), point(14, 10)];
    // 13 × 50 and one 10: the median is 50, the mean would be 47.1.
    expect(hrvBelowUsual([today(40), ...skewed])?.median).toBe(50);
  });

  test("from wearable summaries end to end", () => {
    const metrics = [
      metric("sleep.hrv", daysBefore(0), 36),
      ...usualDays(20, 48).map((p) => metric("sleep.hrv", p.day, p.value)),
    ];
    expect(wearableLiveVitals(metrics).hrvBelow).toEqual({
      latest: 36,
      median: 48,
      day: "2026-10-18",
      source: "Oura",
    });
  });
});
