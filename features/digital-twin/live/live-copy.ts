import { formatDate, formatMeasure, formatNumber } from "@/infrastructure/format-measure";
import { type AtlasScheme } from "@/packages/anatomy/manifest";

import { AV_DELAY_S } from "./heart-cycle";
import { type HeartRhythm } from "./heart-rhythm";
import { type HrvBelowUsual, type LiveRate } from "./live-rates";

type HeartTiming = HeartRhythm["timing"];
import { type NightEpoch, type SleepStage } from "./night-series";

/**
 * Copy for the live twin, in one place so `lint:claims` sees it. Factual:
 * what moves, at which measured value, when it was last measured and by
 * whom. Never a judgement of the value; the HRV line compares a person only
 * with their own usual level. An old reading still animates, and its age is
 * always said.
 */
export const LIVE_TOGGLE = "Live vitals";
/** Title of the box with these lines (and the motion lines); it folds away. */
export const LIVE_PANEL = "What moves";
export const NO_RATE = "No heart rate on record for this subject.";
export const SHOW_ORGANS =
  "Live vitals move the heart and lungs: set Depth to Organs to see them.";
export const ILLUSTRATIVE = "Illustrative, not a physiological simulation.";
/** Heart chambers (#53): the toolbar toggle and the lines while they beat. */
export const CHAMBERS_TOGGLE = "Heart chambers";
export const CHAMBERS_ILLUSTRATIVE =
  "Illustrative simulation, not a physiological model.";
export const CHAMBERS_LINE = `Heart chambers: the region where the atria sit contracts, then the ventricles' region ${Math.round(AV_DELAY_S * 1000)} ms later (an illustrative delay). The atlas heart is one mesh, so the regions are approximate.`;

/** Where the beat times come from, and for AF what the atria are doing now. */
export const chambersTimingLine = (timing: HeartTiming, now: "sinus" | "af"): string => {
  switch (timing) {
    case "regular":
      return "Beat timing: regular, at the heart rate above. The wearable gives a rate, not the time of each beat.";
    case "sinus":
      return "Beat timing: a simulated sinus rhythm with beat-to-beat variation from the rhythm simulator, paced to the heart rate above.";
    case "paroxysmal_af":
      return `Beat timing: simulated by the rhythm simulator with an episode of atrial fibrillation, because this synthetic person's record lists it on that day. Now: ${
        now === "af"
          ? "atrial fibrillation, so the atria quiver and the beats come irregularly."
          : "sinus rhythm."
      }`;
  }
};

export const BODYPARTS3D_HEART_NOTE =
  "On this atlas the heart is part of the whole cardiovascular system, so the system glows, more softly.";
export const BODYPARTS3D_BREATH_NOTE =
  "On this atlas the lungs are part of the whole respiratory system, nose and airways included, so the system glows instead of moving.";

const DAY_MS = 86_400_000;
const dayNumber = (day: string): number => Date.parse(`${day}T00:00:00Z`) / DAY_MS;

const plural = (count: number, unit: string): string =>
  `${count} ${unit}${count === 1 ? "" : "s"} ago`;

/**
 * How old a reading is, in plain words: "today", "3 days ago", "5 months
 * ago", "2 years ago". Both are ISO days; `today` is the viewer's own day.
 */
export const readingAge = (day: string, today: string): string => {
  const days = Math.round(dayNumber(today) - dayNumber(day));
  if (!Number.isFinite(days)) return "date unknown";
  if (days < 0) return "a date after today";
  if (days === 0) return "today";
  if (days < 30) return plural(days, "day");
  if (days < 365) return plural(Math.max(1, Math.floor(days / 30.4375)), "month");
  return plural(Math.floor(days / 365.25), "year");
};

const RATE_NAME: Readonly<Record<LiveRate["vital"], string>> = {
  heartRate: "heart rate",
  rhr: "resting heart rate",
  respiration: "respiratory rate",
};

const lastReading = (day: string, today: string): string =>
  `last reading ${formatDate(day)} (${readingAge(day, today)})`;

export const pulseLine = (rate: LiveRate, today: string): string =>
  `Pulse at ${formatMeasure("heartRate", rate.perMinute)} · ${lastReading(rate.day, today)} · ${rate.source} ${RATE_NAME[rate.vital]}`;

export const breathingLine = (rate: LiveRate, today: string): string =>
  `Breathing at ${formatNumber(rate.perMinute, 0)} per minute · ${lastReading(rate.day, today)} · ${rate.source} ${RATE_NAME[rate.vital]}`;

export const hrvLine = (hrv: HrvBelowUsual, scheme: AtlasScheme, today: string): string =>
  `Soft glow on the ${scheme === "hra" ? "brain" : "nervous system"}: HRV below this person's usual level · ` +
  `${formatMeasure("hrv", hrv.latest)}, ${lastReading(hrv.day, today)} · ` +
  `usual level ${formatMeasure("hrv", hrv.median)}, median of the previous 28 days · ${hrv.source}`;

/** Night playback: a synthetic night replayed on the twin, said as such every time. */
export const NIGHT_TOGGLE = "Night playback";
export const NIGHT_NEEDS_READINGS =
  "Night playback needs readings through the night, which the wearable syncs don't store yet.";
export const NIGHT_ABOUT =
  "A synthetic night made up by a seeded generator, not a recording of anyone: heart rate, breathing rate and sleep stage every five minutes drive the twin. A visual cue, not a physiological model.";
export const NIGHT_GAP =
  "No reading at this time, so the twin stands still. Nothing is filled in.";
export const NIGHT_REDUCED_MOTION =
  "Reduced motion is on: the twin stays still and playback is off. Scrub to step through the night.";

const STAGE_NAME: Readonly<Record<SleepStage, string>> = {
  awake: "Awake",
  light: "Light sleep",
  deep: "Deep sleep",
  rem: "REM sleep",
};

/** "02:35 · Deep sleep · heart rate 54 bpm · breathing 12.8 per minute", or the gap. */
export const nightReadout = (clock: string, epoch: NightEpoch | null): string =>
  epoch === null || epoch.heart === null
    ? `${clock} · no reading`
    : [
        clock,
        epoch.stage ? STAGE_NAME[epoch.stage] : null,
        `heart rate ${formatMeasure("heartRate", epoch.heart)}`,
        epoch.breath === null
          ? null
          : `breathing ${formatNumber(epoch.breath, 1)} per minute`,
      ]
        .filter((part): part is string => part !== null)
        .join(" · ");
