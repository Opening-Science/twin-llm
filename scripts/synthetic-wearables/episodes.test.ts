import { describe, expect, test } from "bun:test";

import { EPISODE_MAX_DAYS, EPISODE_MIN_DAYS, inGenericEpisode } from "./episodes";
import { generateSeries, seriesEpisodeFlags, windowDays } from "./series";

const SEED = 4242;
const ONSET = "2024-06-15";

/** 90 days before the onset and 90 from it, as the heart-brain recovery study. */
const AROUND_ONSET = { endDay: "2024-09-12", days: 180 } as const;

const episodeDays = (
  subjectRef: string,
  window: Readonly<{ endDay: string; days: number }>,
  generatorVersion?: "2" | "3",
): string[] => {
  const options = { seed: SEED, subjectRef, ...window, generatorVersion };
  const flags = seriesEpisodeFlags(options);
  return windowDays(window.endDay, window.days).filter((_, index) => flags[index]);
};

const SUBJECTS = Array.from({ length: 2000 }, (_, index) => `s${index}`);

describe("inGenericEpisode", () => {
  test("is fixed for a subject key and day", () => {
    const days = windowDays("2026-10-01", 3650);
    const key = `${SEED}:subject-0001`;
    expect(days.map((day) => inGenericEpisode(key, day))).toEqual(
      days.map((day) => inGenericEpisode(key, day)),
    );
  });

  test("episodes last 4 to 6 days, about one per person-year", () => {
    const days = windowDays("2026-10-01", 3650);
    const runs = SUBJECTS.slice(0, 200).flatMap((subject) => {
      const flags = days.map((day) => inGenericEpisode(`${SEED}:${subject}`, day));
      // Whole runs only: one cut by the window's first or last day is left out.
      return flags.flatMap((flag, index) => {
        if (!flag || index === 0 || flags[index - 1] === true) return [];
        const end = flags.indexOf(false, index);
        return end === -1 ? [] : [end - index];
      });
    });
    // Overlapping episodes merge into one longer run, which is rare.
    const single = runs.filter((length) => length <= EPISODE_MAX_DAYS);
    expect(single.length / runs.length).toBeGreaterThan(0.95);
    expect(Math.min(...runs)).toBeGreaterThanOrEqual(EPISODE_MIN_DAYS);
    // 200 subjects over 10 years: about 2000 episodes.
    expect(runs.length).toBeGreaterThan(1700);
    expect(runs.length).toBeLessThan(2300);
  });
});

describe("seriesEpisodeFlags", () => {
  test("v3 episode dates do not change when the window changes", () => {
    const windows = [
      AROUND_ONSET,
      { endDay: "2024-12-31", days: 365 },
      { endDay: "2024-08-01", days: 60 },
    ];
    for (const subject of SUBJECTS.slice(0, 300)) {
      const reference = new Set(
        episodeDays(subject, { endDay: "2025-06-30", days: 730 }),
      );
      for (const window of windows) {
        const inWindow = new Set(windowDays(window.endDay, window.days));
        expect(episodeDays(subject, window)).toEqual(
          [...reference].filter((day) => inWindow.has(day)),
        );
      }
    }
  });

  test("v2 episodes still move with the window", () => {
    const moved = SUBJECTS.slice(0, 100).some((subject) => {
      const long = episodeDays(subject, { endDay: "2024-09-12", days: 180 }, "2");
      const short = episodeDays(subject, { endDay: "2024-08-01", days: 90 }, "2");
      return short.length > 0 && !short.every((day) => long.includes(day));
    });
    expect(moved).toBe(true);
  });

  test("v3 episode days are balanced before and after a fixed onset", () => {
    const all = SUBJECTS.flatMap((subject) => episodeDays(subject, AROUND_ONSET));
    const before = all.filter((day) => day < ONSET).length;
    const after = all.length - before;
    expect(all.length).toBeGreaterThan(3000);
    expect(Math.abs(before - after) / all.length).toBeLessThan(0.08);
  });

  test("v2 put every episode day after that onset", () => {
    const all = SUBJECTS.slice(0, 500).flatMap((subject) =>
      episodeDays(subject, AROUND_ONSET, "2"),
    );
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((day) => day >= ONSET)).toBe(true);
  });

  test("an episode day raises the resting heart rate in the series", () => {
    const subject = SUBJECTS.find((ref) => episodeDays(ref, AROUND_ONSET).length >= 4);
    expect(subject).toBeDefined();
    const options = { seed: SEED, subjectRef: subject ?? "", ...AROUND_ONSET };
    const flags = seriesEpisodeFlags(options);
    const days = windowDays(options.endDay, options.days);
    const resting = generateSeries(options).filter(
      (reading) => reading.metric === "resting_heart_rate",
    );
    const mean = (inEpisode: boolean) => {
      const values = resting
        .filter((reading) => flags[days.indexOf(reading.day)] === inEpisode)
        .map((reading) => reading.value);
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    };
    expect(mean(true) - mean(false)).toBeGreaterThan(3);
  });
});
