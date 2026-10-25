import {
  formatDate,
  formatMeasure,
  measureKindFor,
} from "@/infrastructure/format-measure";

import { latestByPrefix, numericValue, scoreBand, type Metric } from "./metric-utils";

/**
 * Dashboard headings, kept pure so the words are tested per source.
 *
 * `scoreBand` reads a 0–100 score. It applies only to metrics on that scale
 * (Oura scores, Whoop recovery and sleep performance). Whoop strain runs 0–21
 * and Google Health reports steps and heart rate, so those get a value, never
 * a band.
 */

export type WearableSource = "oura" | "whoop" | "google-health";

export const SOURCE_LABEL: Readonly<Record<WearableSource, string>> = {
  oura: "Oura",
  whoop: "Whoop",
  "google-health": "Google Health",
};

const latest = (metrics: readonly Metric[], prefix: string): number | null =>
  numericValue(latestByPrefix(metrics, prefix));

export const heroEyebrow = (
  source: WearableSource,
  startDate: string,
  endDate: string,
): string =>
  `${SOURCE_LABEL[source]} · ${formatDate(startDate)} → ${formatDate(endDate)}`;

/** "Solid sleep", or null when there is no reading to band. */
const bandPart = (value: number | null, noun: string): string | null =>
  value === null ? null : `${scoreBand(value).toLowerCase()} ${noun}`;

/** Joins the parts that have a reading; a missing half is dropped, not dashed. */
const headline = (parts: readonly (string | null)[], empty: string): string => {
  const present = parts.filter((part): part is string => part !== null);
  if (present.length === 0) return empty;
  const text = present.join(" · ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export const heroHeadline = (
  source: WearableSource,
  metrics: readonly Metric[],
): string => {
  if (source === "oura") {
    return headline(
      [
        bandPart(latest(metrics, "readiness.score."), "readiness"),
        bandPart(latest(metrics, "sleep.score."), "sleep"),
      ],
      "No readiness or sleep score",
    );
  }
  if (source === "whoop") {
    return headline(
      [
        bandPart(latest(metrics, "whoop.recovery.score."), "recovery"),
        bandPart(latest(metrics, "whoop.sleep.performance."), "sleep"),
      ],
      "No recovery or sleep score",
    );
  }
  const steps = latest(metrics, "google.steps.");
  const restingHr = latest(metrics, "google.daily-resting-heart-rate.");
  return headline(
    [
      steps === null ? null : `${formatMeasure("steps", steps)} steps`,
      restingHr === null ? null : `${formatMeasure("heartRate", restingHr)} resting`,
    ],
    "No steps or resting heart rate",
  );
};

const SECTION_PREFIX: Readonly<Record<WearableSource, Readonly<Record<string, string>>>> =
  {
    oura: {
      Sleep: "sleep.score.",
      Readiness: "readiness.score.",
      Activity: "activity.score.",
    },
    whoop: {
      Recovery: "whoop.recovery.score.",
      Strain: "whoop.cycle.strain.",
      Sleep: "whoop.sleep.performance.",
    },
    "google-health": {},
  };

/** The metric a section's heading and small chart follow, or null for a plain list. */
export const sectionScorePrefix = (
  source: WearableSource,
  title: string,
): string | null => SECTION_PREFIX[source][title] ?? null;

export const sectionHeading = (
  source: WearableSource,
  title: string,
  metrics: readonly Metric[],
): string => {
  const prefix = sectionScorePrefix(source, title);
  if (!prefix) return title;
  const value = latest(metrics, prefix);
  if (value === null) return title;
  const kind = measureKindFor(prefix) ?? "score";
  if (kind === "score" || kind === "percent") {
    return `${scoreBand(value)} · ${formatMeasure(kind, value)}`;
  }
  return `${title} · ${formatMeasure(kind, value)}`;
};
