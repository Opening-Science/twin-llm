import type { WearableSource } from "../dashboard-headings";
import { SOURCE_SERIES, type KitCard } from "../kit-cards";
import { ACCURACY_NOTES, ACCURACY_ROWS, ACCURACY_SOURCES } from "./accuracy-notes";
import type {
  AccuracyDevice,
  AccuracyMeasure,
  AccuracyNote,
  AccuracySource,
  EvidenceLevel,
} from "./types";

/**
 * Which accuracy note belongs under which dashboard card. Pure: a card's
 * stored series names its measure, the source names the device family.
 *
 * A series the review did not cover (steps, Oura's Activity Score, WHOOP's
 * Sleep Performance, sleep efficiency, active minutes, bedtimes) gets no
 * note: saying "no validation found" there would claim more than the review
 * looked for. Where the card shows a near measure rather than the one
 * studied, the note says so.
 */

type MeasureOfStem = Readonly<{ measure: AccuracyMeasure; remark?: string }>;

/** Stored series stems (as in `INSIGHT_METRIC_BY_STEM`) and the reviewed measure each one is. */
export const MEASURE_BY_STEM: Readonly<Record<string, MeasureOfStem | null>> = {
  "sleep.hr": {
    measure: "restingHeartRate",
    remark:
      "This card shows average heart rate during sleep. The note is about nightly resting heart rate, the closest measure reviewed.",
  },
  "whoop.recovery.rhr": { measure: "restingHeartRate" },
  "google.daily-resting-heart-rate": { measure: "restingHeartRate" },
  "google.heart-rate": {
    measure: "exerciseHeartRate",
    remark:
      "This is heart rate through the day. The note is about heart rate during rest, walking and exercise, the closest measure reviewed.",
  },
  "sleep.hrv": { measure: "hrv" },
  "whoop.recovery.hrv": { measure: "hrv" },
  "google.daily-heart-rate-variability": { measure: "hrv" },
  "sleep.duration": { measure: "totalSleepTime" },
  "whoop.sleep.in_bed_min": {
    measure: "totalSleepTime",
    remark:
      "This card shows time in bed. The note is about total sleep time, the closest measure reviewed.",
  },
  "readiness.score": { measure: "compositeScores" },
  "sleep.score": { measure: "compositeScores" },
  "whoop.recovery.score": { measure: "compositeScores" },
  "whoop.recovery.spo2": { measure: "spo2" },
  "google.daily-oxygen-saturation": { measure: "spo2" },
  "sleep.stages": { measure: "sleepStages" },
  "activity.score": null,
  "whoop.sleep.performance": null,
  "activity.steps": null,
  "google.steps": null,
  "sleep.efficiency": null,
  "google.active-minutes": null,
  "sleep.bedtime": null,
};

export const EVIDENCE_WORD: Readonly<Record<EvidenceLevel, string>> = {
  validated: "Validated",
  limited: "Limited evidence",
  none: "No validation found",
};

const DEVICE_NAME: Readonly<Record<AccuracyDevice, string>> = {
  oura: "Oura",
  whoop: "WHOOP",
  fitbit: "Fitbit",
  "pixel-watch": "Google Pixel Watch",
};

/**
 * The device family whose notes a source's cards take. Google Health carries
 * Fitbit and Pixel Watch data; without the model the note is Fitbit's, and
 * the card says so.
 */
export const accuracyDevice = (
  source: WearableSource,
  deviceModel?: string,
): Readonly<{ device: AccuracyDevice; remark?: string }> => {
  if (source === "oura") return { device: "oura" };
  if (source === "whoop") return { device: "whoop" };
  if (deviceModel) {
    const device = /pixel/i.test(deviceModel) ? "pixel-watch" : "fitbit";
    return {
      device,
      remark: `Recorded by a ${deviceModel}; this is the note for ${DEVICE_NAME[device]}.`,
    };
  }
  return {
    device: "fitbit",
    remark:
      "Google Health does not say which device recorded this, so this is the note for Fitbit, the closest device family.",
  };
};

export type CitedSource = AccuracySource & Readonly<{ id: string; href: string }>;

export type CardAccuracyEntry = Readonly<{
  /** The radar part this entry is for; null on a single-measure card. */
  part: string | null;
  measure: AccuracyMeasure;
  evidence: EvidenceLevel;
  note: string;
  funding: string | null;
  /** Set when the card shows a near measure rather than the one studied. */
  remark: string | null;
  sources: readonly CitedSource[];
}>;

export type CardAccuracy = Readonly<{
  device: AccuracyDevice;
  /** Which device the notes are for, when the source does not say. */
  deviceRemark: string | null;
  entries: readonly CardAccuracyEntry[];
}>;

const noteFor = (device: AccuracyDevice, measure: AccuracyMeasure): AccuracyNote | null =>
  ACCURACY_NOTES.find((n) => n.device === device && n.measure === measure) ?? null;

const sourcesOf = (note: AccuracyNote): CitedSource[] =>
  [...new Set(note.rows.map((row) => ACCURACY_ROWS[row]!.source))].map((id) => {
    const source: AccuracySource = ACCURACY_SOURCES[id];
    return {
      ...source,
      id,
      href: source.doi ? `https://doi.org/${source.doi}` : source.url,
    };
  });

/** A stored series prefix ("sleep.hrv.") as its stem ("sleep.hrv"). */
const stem = (prefix: string): string => prefix.replace(/\.$/, "");

/** The series stems a card draws, each with the label a radar part goes by. */
export const cardStems = (
  source: WearableSource,
  card: KitCard,
): readonly Readonly<{ stem: string; part: string | null }>[] => {
  if (card.chart === "radar") {
    return SOURCE_SERIES[source].radar.parts.map((series) => ({
      stem: stem(series.prefix),
      part: series.label.replace(/^[^:]+: /, ""),
    }));
  }
  if (card.id === "night:stages") return [{ stem: "sleep.stages", part: null }];
  if (card.id === "nights:bedtime") return [{ stem: "sleep.bedtime", part: null }];
  if (card.id === "day:steps") {
    const steps = SOURCE_SERIES[source].steps;
    return steps ? [{ stem: stem(steps.prefix), part: null }] : [];
  }
  if (card.id.startsWith("empty:")) return [];
  return [{ stem: stem(card.id.slice(card.id.indexOf(":") + 1)), part: null }];
};

/**
 * The accuracy notes under one card, one per measure it draws that the review
 * covered; null for a card with none, and while the card is loading. A stem
 * missing from `MEASURE_BY_STEM` gets no note (a test keeps the table whole).
 */
export const cardAccuracy = (
  source: WearableSource,
  card: KitCard,
  deviceModel?: string,
): CardAccuracy | null => {
  if (card.state === "loading") return null;
  const family = accuracyDevice(source, deviceModel);
  const entries = cardStems(source, card).flatMap(({ stem: key, part }) => {
    const mapped = MEASURE_BY_STEM[key];
    const note = mapped ? noteFor(family.device, mapped.measure) : null;
    if (!mapped || !note) return [];
    return [
      {
        part,
        measure: mapped.measure,
        evidence: note.evidence,
        note: note.note,
        funding: note.funding,
        remark: mapped.remark ?? null,
        sources: sourcesOf(note),
      },
    ];
  });
  return entries.length === 0
    ? null
    : { device: family.device, deviceRemark: family.remark ?? null, entries };
};
