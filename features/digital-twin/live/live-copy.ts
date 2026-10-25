import { formatDate, formatMeasure, formatNumber } from "@/infrastructure/format-measure";
import { type AtlasScheme } from "@/packages/anatomy/manifest";

import { type HrvBelowUsual, type LiveRate } from "./live-rates";

/**
 * Copy for the live twin, in one place so `lint:claims` sees it. Factual:
 * what moves, at which measured value, when it was last measured and by
 * whom. Never a judgement of the value; the HRV line compares a person only
 * with their own usual level. An old reading still animates, and its age is
 * always said.
 */
export const LIVE_TOGGLE = "Live vitals";
export const NO_RATE = "No heart rate on record for this subject.";
export const SHOW_ORGANS =
  "Live vitals move the heart and lungs: set Depth to Organs to see them.";
export const ILLUSTRATIVE = "Illustrative, not a physiological simulation.";
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
