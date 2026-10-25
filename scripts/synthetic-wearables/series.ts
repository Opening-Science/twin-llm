/**
 * Deterministic daily wearable series for one synthetic subject.
 *
 * Every number here is made up by a seeded generator; none comes from a device
 * or a person. Ranges are plausible for adults (resting heart rate 45–90 /min,
 * RMSSD 10–150 ms, sleep 4–10 h, …) so the tools and the training answers
 * have realistic magnitudes, nothing more. Pure: no I/O, no clock.
 */
import { normal, type Random, randomFor } from "./random";

/** Codings follow the open-twin mappers at the pinned SHA (see docs/training-data.md). */
export const LOINC_SYSTEM = "http://loinc.org";
/** No LOINC code exists for RMSSD or a vendor sleep score; open-twin uses vendor-local codes. */
export const SYNTHETIC_WEARABLE_SYSTEM = "urn:twinllm:synthetic-wearable";

export const WEARABLE_METRICS = {
  heart_rate: {
    system: LOINC_SYSTEM,
    code: "8867-4",
    display: "Heart rate",
    unit: "/min",
    unitLabel: "per minute",
    time: "12:00:00",
    category: "vital-signs",
  },
  resting_heart_rate: {
    system: LOINC_SYSTEM,
    code: "40443-4",
    display: "Heart rate --resting",
    unit: "/min",
    unitLabel: "per minute",
    time: "07:00:00",
    category: "vital-signs",
  },
  hrv_rmssd: {
    system: SYNTHETIC_WEARABLE_SYSTEM,
    code: "hrv-rmssd",
    display: "Heart rate variability, RMSSD (synthetic)",
    unit: "ms",
    unitLabel: "millisecond",
    time: "07:00:00",
    category: "vital-signs",
  },
  sleep_duration: {
    system: LOINC_SYSTEM,
    code: "93832-4",
    display: "Sleep duration",
    unit: "min",
    unitLabel: "minute",
    time: "07:00:00",
    category: "activity",
  },
  sleep_score: {
    system: SYNTHETIC_WEARABLE_SYSTEM,
    code: "sleep-score",
    display: "Sleep score (synthetic)",
    unit: "{score}",
    unitLabel: "score",
    time: "07:00:00",
    category: "activity",
  },
  steps: {
    system: LOINC_SYSTEM,
    code: "41950-7",
    display: "Number of steps in 24 hour Measured",
    unit: "{steps}/d",
    unitLabel: "steps per day",
    time: "23:00:00",
    category: "activity",
  },
  respiratory_rate: {
    system: LOINC_SYSTEM,
    code: "9279-1",
    display: "Respiratory rate",
    unit: "/min",
    unitLabel: "per minute",
    time: "07:00:00",
    category: "vital-signs",
  },
} as const;

export type WearableMetric = keyof typeof WEARABLE_METRICS;

export const WEARABLE_METRIC_NAMES = Object.keys(WEARABLE_METRICS) as WearableMetric[];

export const DEFAULT_END_DAY = "2026-10-01";
export const DEFAULT_DAYS = 90;

/** What makes one subject's series their own, drawn once per subject. */
export type SubjectProfile = Readonly<{
  restingHr: number;
  hrv: number;
  sleepMinutes: number;
  steps: number;
  respiration: number;
  /** Share of days with any reading. */
  wearRate: number;
  /** Resting heart rate change per day over the window. */
  restingDriftPerDay: number;
  /** A few days of raised resting heart rate near the end, or null. */
  episode: Readonly<{ startIndex: number; length: number }> | null;
}>;

export type DailyReading = Readonly<{
  day: string;
  metric: WearableMetric;
  value: number;
}>;

export type SeriesOptions = Readonly<{
  seed: number;
  subjectRef: string;
  endDay: string;
  days: number;
}>;

const round = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/** One subject in twelve barely wears the device, so "not enough data" cases exist. */
const SPARSE_SHARE = 1 / 12;
const EPISODE_SHARE = 0.3;

export const subjectProfile = (seed: number, subjectRef: string): SubjectProfile => {
  const random = randomFor(seed, `profile:${subjectRef}`);
  const draws = Array.from({ length: 9 }, () => random());
  const [hr, hrv, sleep, steps, resp, wear, drift, episode, episodeAt] = draws as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const sparse = wear < SPARSE_SHARE;
  return {
    restingHr: round(52 + 18 * hr, 1),
    // Higher resting heart rate tends to come with lower HRV.
    hrv: round(25 + 55 * hrv * (1 - 0.4 * hr), 1),
    sleepMinutes: round(380 + 90 * sleep, 1),
    steps: Math.round(4000 + 8000 * steps),
    respiration: round(13 + 4 * resp, 1),
    wearRate: sparse ? 0.15 : round(0.8 + 0.19 * wear, 3),
    restingDriftPerDay: round((drift - 0.5) * 0.04, 4),
    episode:
      episode < EPISODE_SHARE
        ? { startIndex: Math.floor(episodeAt * 20), length: 4 + Math.floor(episode * 10) }
        : null,
  };
};

const DAY_MS = 86_400_000;

/** `days` calendar days ending on `endDay` (inclusive), oldest first. */
export const windowDays = (endDay: string, days: number): string[] => {
  const end = Date.parse(`${endDay}T00:00:00Z`);
  return Array.from({ length: days }, (_, index) =>
    new Date(end - (days - 1 - index) * DAY_MS).toISOString().slice(0, 10),
  );
};

const isWeekend = (day: string): boolean => {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
};

/**
 * One day's readings. Draws a fixed number of values whether or not the day is
 * worn, so a change to one metric never shifts another day's numbers.
 */
const dayReadings = (
  profile: SubjectProfile,
  random: Random,
  day: string,
  index: number,
  days: number,
): DailyReading[] => {
  const worn = random() < profile.wearRate;
  const noise = Array.from({ length: 6 }, () => normal(random));
  const [nHr, nHrv, nSleep, nSteps, nResp, nScore] = noise as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (!worn) return [];
  // The episode sits in the last 30 days of the window.
  const episodeStart = profile.episode ? days - 30 + profile.episode.startIndex : -1;
  const inEpisode =
    profile.episode !== null &&
    index >= episodeStart &&
    index < episodeStart + profile.episode.length;
  const restingHr = clamp(
    profile.restingHr +
      profile.restingDriftPerDay * index +
      2 * nHr +
      (inEpisode ? 7 : 0),
    45,
    90,
  );
  const hrv = clamp(profile.hrv * (inEpisode ? 0.72 : 1) + 6 * nHrv, 10, 150);
  const sleepMinutes = clamp(profile.sleepMinutes + 35 * nSleep, 240, 600);
  const steps = clamp(
    profile.steps * (isWeekend(day) ? 0.85 : 1) + 1800 * nSteps,
    500,
    30000,
  );
  const respiration = clamp(
    profile.respiration + 0.6 * nResp + (inEpisode ? 1.5 : 0),
    10,
    24,
  );
  const sleepScore = clamp(
    62 + (sleepMinutes - 360) / 6 + ((hrv - profile.hrv) / profile.hrv) * 20 + 5 * nScore,
    30,
    100,
  );
  const values: Record<WearableMetric, number> = {
    heart_rate: Math.round(restingHr + 14 + 3 * nHr),
    resting_heart_rate: Math.round(restingHr),
    hrv_rmssd: Math.round(hrv),
    sleep_duration: Math.round(sleepMinutes),
    sleep_score: Math.round(sleepScore),
    steps: Math.round(steps),
    respiratory_rate: round(respiration, 1),
  };
  return WEARABLE_METRIC_NAMES.map((metric) => ({ day, metric, value: values[metric] }));
};

export const generateSeries = (options: SeriesOptions): DailyReading[] => {
  const profile = subjectProfile(options.seed, options.subjectRef);
  const random = randomFor(options.seed, `series:${options.subjectRef}`);
  return windowDays(options.endDay, options.days).flatMap((day, index) =>
    dayReadings(profile, random, day, index, options.days),
  );
};
