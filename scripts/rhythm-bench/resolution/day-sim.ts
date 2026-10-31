/**
 * Whole simulated days for the resolution study (#290), built from 144
 * ten-minute recordings of packages/rhythm-sim (it makes 30 to 600 s at a
 * time). Reads the simulator; changes nothing in it. Pure and seeded.
 *
 * The simulator has no time of day, activity or sleep, so the day layer adds
 * them through each recording's rates (assumptions, docs/rhythm-sim.md,
 * "Beats to daily summaries"):
 *
 * - a circadian swing of the rate, lowest at 03:00 and highest at 15:00,
 *   `CIRCADIAN_HR_AMPLITUDE` either side;
 * - a day offset (normal, SD `DAY_HR_SD`) and a per-recording offset (normal,
 *   SD `ACTIVITY_HR_SD` from 07:00 to 23:00, `REST_HR_SD` otherwise), applied
 *   to the sinus rate and to the ventricular rate in AF alike;
 * - from 07:00 to 23:00, an activity bout in `ACTIVITY_BOUT_SHARE` of the
 *   recordings that raises both rates by 15 to 45 /min for its ten minutes;
 * - 0 to 3 PACs and 0 to 2 PVCs in every recording without AF, as
 *   `rhythm_irregularity` plans its recordings.
 *
 * An AF day has one episode of `burden` × 24 h at a seeded start. Recordings
 * are joined end to end: each one's first beat is the previous one's last,
 * so no interval is invented, and the day ends up to about a minute short of
 * 24 h (each recording stops at its last whole beat).
 */
import { hash32, normal, randomFor } from "@/infrastructure/seeded-random";
import { subjectRhythmSettings } from "@/packages/query-tools/rhythm-recording";
import { type BeatLabel } from "@/packages/rhythm-sim/ectopic-beats";
import { type RecordingConfigInput } from "@/packages/rhythm-sim/recording-config";
import { simulateRecording } from "@/packages/rhythm-sim/simulate-recording";

import { type Perturbation, perturbBeats } from "../perturb";
import { type Interval, intervalsFromBeats } from "./aggregate";

export const SEGMENT_SEC = 600;
export const SEGMENTS_PER_DAY = 144;
export const DAY_SEC = SEGMENT_SEC * SEGMENTS_PER_DAY;

export const CIRCADIAN_HR_AMPLITUDE = 7;
export const DAY_HR_SD = 2;
export const ACTIVITY_HR_SD = 5;
export const REST_HR_SD = 1.5;
export const ACTIVITY_BOUT_SHARE = 0.1;
export const ACTIVITY_BOUT_HR = [15, 45] as const;

export type AfEpisode = Readonly<{ startSec: number; endSec: number }>;

/** Rate offset by time of day, /min: −amplitude at 03:00, +amplitude at 15:00. */
export const circadianHrOffset = (hourOfDay: number): number =>
  -CIRCADIAN_HR_AMPLITUDE * Math.cos((2 * Math.PI * (hourOfDay - 3)) / 24);

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));
const tenth = (value: number): number => Math.round(value * 10) / 10;

/** The day's AF episode for a burden (share of the day), or null for 0. */
export const dayEpisode = (burden: number, seed: number): AfEpisode | null => {
  if (burden <= 0) return null;
  const length = Math.min(DAY_SEC, Math.round(burden * DAY_SEC));
  const start = Math.round(randomFor(seed, "episode")() * (DAY_SEC - length));
  return { startSec: start, endSec: start + length };
};

export type DayPlan = Readonly<{
  subjectRef: string;
  day: number;
  burden: number;
}>;

export const daySeed = (plan: DayPlan): number =>
  hash32(`af-resolution:${plan.subjectRef}:${plan.day}`);

/** The simulator config of each ten-minute recording of a day, in order. */
export const dayConfigs = (plan: DayPlan): RecordingConfigInput[] => {
  const seed = daySeed(plan);
  const settings = subjectRhythmSettings(plan.subjectRef);
  const episode = dayEpisode(plan.burden, seed);
  const random = randomFor(seed, "day-rates");
  const dayOffset = DAY_HR_SD * normal(random);
  return Array.from({ length: SEGMENTS_PER_DAY }, (_, k) => {
    const start = k * SEGMENT_SEC;
    const hour = (start + SEGMENT_SEC / 2) / 3600;
    const active = hour >= 7 && hour < 23;
    const spread = normal(random);
    const bout = random() < ACTIVITY_BOUT_SHARE;
    const boutSize =
      ACTIVITY_BOUT_HR[0] + (ACTIVITY_BOUT_HR[1] - ACTIVITY_BOUT_HR[0]) * random();
    const offset =
      circadianHrOffset(hour) +
      dayOffset +
      (active ? ACTIVITY_HR_SD : REST_HR_SD) * spread +
      (active && bout ? boutSize : 0);
    const pacCount = Math.floor(random() * 4);
    const pvcCount = Math.floor(random() * 3);
    const overlapStart = episode === null ? 0 : Math.max(episode.startSec, start) - start;
    const overlapEnd =
      episode === null ? 0 : Math.min(episode.endSec, start + SEGMENT_SEC) - start;
    const common = {
      seed: hash32(`${seed}:${k}`),
      durationSec: SEGMENT_SEC,
      meanHr: tenth(clamp(settings.meanHr + offset, 40, 150)),
      rrSdMs: settings.rrSdMs,
      respRateHz: settings.respRateHz,
      afMeanHr: tenth(clamp(settings.afMeanHr + offset, 50, 180)),
      afCv: settings.afCv,
    };
    if (overlapEnd <= overlapStart)
      return { ...common, rhythm: "sinus", pacCount, pvcCount };
    if (overlapStart === 0 && overlapEnd === SEGMENT_SEC)
      return { ...common, rhythm: "af" };
    return {
      ...common,
      rhythm: "paroxysmal_af",
      afEpisodes: [{ startSec: overlapStart, endSec: overlapEnd }],
    };
  });
};

export type SimulatedDay = Readonly<{
  plan: DayPlan;
  episode: AfEpisode | null;
  beatTimesMs: readonly number[];
  labels: readonly BeatLabel[];
}>;

/** A day's beats from midnight, the recordings joined end to end. */
export const simulateDay = (plan: DayPlan): SimulatedDay => {
  const beatTimesMs: number[] = [];
  const labels: BeatLabel[] = [];
  for (const config of dayConfigs(plan)) {
    const recording = simulateRecording(config);
    if (recording.rrMs.length === 0) continue;
    // This recording's first beat is the previous recording's last one.
    const offset = beatTimesMs.at(-1) ?? 0;
    if (beatTimesMs.length === 0) beatTimesMs.push(0);
    for (let i = 1; i < recording.beatTimesMs.length; i += 1) {
      beatTimesMs.push(offset + recording.beatTimesMs[i]);
    }
    labels.push(...recording.labels);
  }
  return { plan, episode: dayEpisode(plan.burden, daySeed(plan)), beatTimesMs, labels };
};

/**
 * The day's intervals after beat-detection noise (`perturbBeats`, seeded by
 * the day and the noise id); an inserted beat keeps the label of the interval
 * it splits, a missed one the label of the beat that ends the merged interval.
 */
export const dayIntervals = (
  day: SimulatedDay,
  noise: Readonly<{ id: string } & Perturbation>,
): Interval[] => {
  const beats = perturbBeats(
    { beatTimesMs: day.beatTimesMs, labels: day.labels },
    noise,
    randomFor(daySeed(day.plan), `noise:${noise.id}`),
  );
  return intervalsFromBeats(beats.beatTimesMs, beats.labels, (label) => label === "af");
};
