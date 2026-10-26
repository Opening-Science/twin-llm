import { type LiveVitals, NO_LIVE_VITALS } from "./live-rates";

/**
 * A night to replay on the live twin, and the playback clock over it, as pure
 * functions of time so every step is testable without a timer.
 *
 * The app stores daily wearable summaries only, so the night is synthetic:
 * a seeded generator makes up five-minute epochs of heart rate, breathing
 * rate and sleep stage, with plausible adult ranges and a short sensor gap.
 * None of it comes from a device or a person. Playback steps from epoch to
 * epoch and never interpolates: inside the gap the values are missing and
 * the twin stands still.
 */

export type SleepStage = "awake" | "light" | "deep" | "rem";

export type NightEpoch = Readonly<{
  /** Minutes from the start of the night. */
  minute: number;
  heart: number | null;
  breath: number | null;
  stage: SleepStage | null;
}>;

export type Night = Readonly<{
  /** ISO time of the first epoch; read as wall-clock time, never shifted. */
  startIso: string;
  /** ISO day the night ends on. */
  day: string;
  epochs: readonly NightEpoch[];
}>;

export const NIGHT_EPOCH_MINUTES = 5;
export const NIGHT_EPOCHS = 96;
export const NIGHT_START_HOUR = 23;
/** Who measured it, for the lines beside the view. */
export const NIGHT_SOURCE = "Synthetic night";

/** FNV-1a, so the same subject always gets the same night. */
const hash32 = (text: string): number =>
  [...text].reduce(
    (hash, char) => Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0,
    0x811c9dc5,
  );

type Random = () => number;

/** mulberry32: small, seeded and the same everywhere. */
const mulberry32 = (seed: number): Random => {
  const state = { a: seed >>> 0 };
  return () => {
    state.a = (state.a + 0x6d2b79f5) >>> 0;
    const t1 = Math.imul(state.a ^ (state.a >>> 15), 1 | state.a);
    const t2 = (t1 + Math.imul(t1 ^ (t1 >>> 7), 61 | t1)) ^ t1;
    return ((t2 ^ (t2 >>> 14)) >>> 0) / 4294967296;
  };
};

const normal = (random: Random): number =>
  Math.sqrt(-2 * Math.log(Math.max(random(), 1e-12))) * Math.cos(2 * Math.PI * random());

const round = (value: number, decimals: number): number =>
  Math.round(value * 10 ** decimals) / 10 ** decimals;

/**
 * The stages, one per epoch: a few minutes awake, then sleep cycles of about
 * 90 minutes with more deep sleep early and more REM late, a brief waking at
 * some cycle ends, and awake at the end.
 */
const syntheticStages = (random: Random): readonly SleepStage[] => {
  const latency = 2 + Math.floor(random() * 3);
  const cycles = Array.from({ length: 6 }, (_, cycle) => {
    const length = 17 + Math.floor(random() * 4);
    const deep = Math.max(1, Math.round(length * Math.max(0.05, 0.4 - 0.09 * cycle)));
    const rem = Math.max(1, Math.round(length * Math.min(0.4, 0.1 + 0.07 * cycle)));
    const light = Math.max(1, length - deep - rem - 1);
    const wake = random() < 0.4 ? 1 : 0;
    return [
      ...Array<SleepStage>(Math.ceil(light / 2)).fill("light"),
      ...Array<SleepStage>(deep).fill("deep"),
      ...Array<SleepStage>(Math.floor(light / 2) + 1 - wake).fill("light"),
      ...Array<SleepStage>(rem).fill("rem"),
      ...Array<SleepStage>(wake).fill("awake"),
    ];
  }).flat();
  const night = [...Array<SleepStage>(latency).fill("awake"), ...cycles];
  return [
    ...night.slice(0, NIGHT_EPOCHS - 2),
    ...Array<SleepStage>(Math.max(0, NIGHT_EPOCHS - 2 - night.length)).fill("light"),
    "awake",
    "awake",
  ];
};

const HEART_OFFSET: Readonly<Record<SleepStage, number>> = {
  awake: 10,
  light: 2,
  deep: -4,
  rem: 5,
};
const BREATH_OFFSET: Readonly<Record<SleepStage, number>> = {
  awake: 2,
  light: 0,
  deep: -1,
  rem: 1.5,
};
/** The sensor gap: four epochs, somewhere in the middle of the night. */
const GAP_EPOCHS = 4;

const previousDay = (day: string): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** The synthetic night for `seedKey` that ends on `day` (ISO). */
export const syntheticNight = (seedKey: string, day: string): Night => {
  const random = mulberry32(hash32(seedKey));
  const restingHeart = 50 + random() * 10;
  const restingBreath = 12 + random() * 3;
  const gapStart = 30 + Math.floor(random() * 40);
  const stages = syntheticStages(random);
  const epochs = stages.map((stage, index): NightEpoch => {
    const minute = index * NIGHT_EPOCH_MINUTES;
    // Draw for every epoch, gap or not, so the gap never shifts the values after it.
    const heartNoise = normal(random);
    const breathNoise = normal(random);
    if (index >= gapStart && index < gapStart + GAP_EPOCHS) {
      return { minute, heart: null, breath: null, stage: null };
    }
    // Heart rate drifts down a few beats over the first half of the night.
    const drift = -3 * Math.min(1, index / (NIGHT_EPOCHS / 2));
    return {
      minute,
      heart: Math.round(restingHeart + HEART_OFFSET[stage] + drift + 1.5 * heartNoise),
      breath: round(restingBreath + BREATH_OFFSET[stage] + 0.4 * breathNoise, 1),
      stage,
    };
  });
  return {
    startIso: `${previousDay(day)}T${String(NIGHT_START_HOUR).padStart(2, "0")}:00:00Z`,
    day,
    epochs,
  };
};

export const nightMinutes = (night: Night): number =>
  night.epochs.length * NIGHT_EPOCH_MINUTES;

/** The epoch the minute falls in, a step and never a blend; null outside the night. */
export const epochAt = (night: Night, minute: number): NightEpoch | null => {
  if (!Number.isFinite(minute) || minute < 0 || minute >= nightMinutes(night)) {
    return null;
  }
  return night.epochs[Math.floor(minute / NIGHT_EPOCH_MINUTES)] ?? null;
};

/** What drives the twin at one epoch. A missing value is no rate, so that part stays still. */
export const nightVitals = (epoch: NightEpoch | null, day: string): LiveVitals =>
  epoch
    ? {
        heart:
          epoch.heart === null
            ? null
            : { perMinute: epoch.heart, day, source: NIGHT_SOURCE, vital: "heartRate" },
        breath:
          epoch.breath === null
            ? null
            : {
                perMinute: epoch.breath,
                day,
                source: NIGHT_SOURCE,
                vital: "respiration",
              },
        hrvBelow: null,
      }
    : NO_LIVE_VITALS;

/** Wall-clock "HH:MM" at a minute of the night. */
export const nightClock = (night: Night, minute: number): string =>
  new Date(Date.parse(night.startIso) + Math.floor(minute) * 60_000)
    .toISOString()
    .slice(11, 16);

/** The ISO time of an epoch, for the chart's x axis. */
export const epochIso = (night: Night, epoch: NightEpoch): string =>
  new Date(Date.parse(night.startIso) + epoch.minute * 60_000).toISOString();

export type Playback = Readonly<{
  minute: number;
  playing: boolean;
  /** Night minutes per real minute. */
  speed: PlaybackSpeed;
}>;

/** 60× plays an hour a minute; 900× the whole night in about half a minute. */
export const PLAYBACK_SPEEDS = [60, 300, 900] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

export const START_PLAYBACK: Playback = { minute: 0, playing: false, speed: 300 };

/** The clock `elapsedMs` of real time later; it stops at the end of the night. */
export const advancePlayback = (
  playback: Playback,
  elapsedMs: number,
  totalMinutes: number,
): Playback => {
  if (!playback.playing || !(elapsedMs > 0)) return playback;
  const minute = playback.minute + (elapsedMs / 60_000) * playback.speed;
  return minute >= totalMinutes
    ? { ...playback, minute: totalMinutes - NIGHT_EPOCH_MINUTES, playing: false }
    : { ...playback, minute };
};

/** Scrubbing moves the clock and keeps playing or paused as it was. */
export const seekPlayback = (
  playback: Playback,
  minute: number,
  totalMinutes: number,
): Playback => ({
  ...playback,
  minute: Math.min(Math.max(0, minute), totalMinutes - NIGHT_EPOCH_MINUTES),
});

/** Play from the start again once the night has played through. */
export const togglePlayback = (playback: Playback, totalMinutes: number): Playback =>
  playback.playing
    ? { ...playback, playing: false }
    : {
        ...playback,
        playing: true,
        minute:
          playback.minute >= totalMinutes - NIGHT_EPOCH_MINUTES ? 0 : playback.minute,
      };
