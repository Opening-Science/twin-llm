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
