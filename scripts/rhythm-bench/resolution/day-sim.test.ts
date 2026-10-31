import { describe, expect, test } from "bun:test";

import { parseRecordingConfig } from "@/packages/rhythm-sim/recording-config";

import { NOISE_LEVELS } from "../sim-grid";
import {
  circadianHrOffset,
  CIRCADIAN_HR_AMPLITUDE,
  DAY_SEC,
  dayConfigs,
  dayEpisode,
  dayIntervals,
  SEGMENT_SEC,
  SEGMENTS_PER_DAY,
  simulateDay,
} from "./day-sim";

describe("circadianHrOffset", () => {
  test("lowest at 03:00, highest at 15:00, zero at 09:00", () => {
    expect(circadianHrOffset(3)).toBe(-CIRCADIAN_HR_AMPLITUDE);
    expect(circadianHrOffset(15)).toBe(CIRCADIAN_HR_AMPLITUDE);
    expect(Math.abs(circadianHrOffset(9))).toBeLessThan(1e-12);
  });
});

describe("dayEpisode", () => {
  test("none at burden 0; otherwise burden × 24 h inside the day, seeded", () => {
    expect(dayEpisode(0, 1)).toBe(null);
    const episode = dayEpisode(0.25, 7);
    expect(episode === null ? null : episode.endSec - episode.startSec).toBe(21_600);
    expect(
      (episode?.startSec ?? -1) >= 0 && (episode?.endSec ?? DAY_SEC + 1) <= DAY_SEC,
    ).toBe(true);
    expect(dayEpisode(0.25, 7)).toEqual(episode);
    expect(dayEpisode(1, 7)).toEqual({ startSec: 0, endSec: DAY_SEC });
  });
});

describe("dayConfigs", () => {
  test("144 valid ten-minute recordings; a sinus day has no AF", () => {
    const configs = dayConfigs({ subjectRef: "s", day: 0, burden: 0 });
    expect(configs.length).toBe(SEGMENTS_PER_DAY);
    expect(configs.every((config) => config.durationSec === SEGMENT_SEC)).toBe(true);
    expect(configs.every((config) => config.rhythm === "sinus")).toBe(true);
    for (const config of configs)
      expect(() => parseRecordingConfig(config)).not.toThrow();
  });

  test("an AF day: AF recordings inside the episode, paroxysmal at its edges, no ectopy there", () => {
    const plan = { subjectRef: "s", day: 1, burden: 0.3 };
    const configs = dayConfigs(plan);
    for (const config of configs)
      expect(() => parseRecordingConfig(config)).not.toThrow();
    const rhythms = configs.map((config) => config.rhythm);
    expect(rhythms.filter((r) => r === "paroxysmal_af").length).toBeLessThanOrEqual(2);
    // 0.3 × 144 = 43.2 recordings: 42 or 43 whole ones.
    expect([42, 43]).toContain(rhythms.filter((r) => r === "af").length);
    expect(
      configs.every(
        (config) =>
          config.rhythm === "sinus" ||
          (config.pacCount ?? 0) + (config.pvcCount ?? 0) === 0,
      ),
    ).toBe(true);
  });
});

describe("simulateDay and dayIntervals", () => {
  const plan = { subjectRef: "af-resolution-test", day: 2, burden: 0.1 };
  const day = simulateDay(plan);

  test("one run of beats from midnight, one label per interval, under 24 h", () => {
    expect(day.beatTimesMs[0]).toBe(0);
    expect(day.labels.length).toBe(day.beatTimesMs.length - 1);
    expect(day.beatTimesMs.every((t, i) => i === 0 || t > day.beatTimesMs[i - 1])).toBe(
      true,
    );
    expect((day.beatTimesMs.at(-1) ?? 0) <= DAY_SEC * 1000).toBe(true);
    expect((day.beatTimesMs.at(-1) ?? 0) > (DAY_SEC - 600) * 1000).toBe(true);
  });

  test("AF beats lie inside the episode (allowing the drift from joining recordings)", () => {
    const episode = day.episode ?? { startSec: 0, endSec: 0 };
    const afTimes = day.labels.flatMap((label, i) =>
      label === "af" ? [day.beatTimesMs[i + 1] / 1000] : [],
    );
    expect(afTimes.length > 0).toBe(true);
    expect(Math.min(...afTimes) >= episode.startSec - 600).toBe(true);
    expect(Math.max(...afTimes) <= episode.endSec + 600).toBe(true);
  });

  test("the same plan gives the same day; noise none keeps every beat", () => {
    expect(simulateDay(plan).beatTimesMs).toEqual(day.beatTimesMs);
    const intervals = dayIntervals(day, NOISE_LEVELS[0]);
    expect(intervals.length).toBe(day.labels.length);
    expect(intervals.filter((each) => each.af).length).toBe(
      day.labels.filter((label) => label === "af").length,
    );
  });
});
