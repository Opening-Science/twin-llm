/**
 * Wearable vitals → body system, for lighting the twin from a subject's own
 * summaries. TwinLLM-authored and visual only. Vitals are not Anchor
 * biomarkers, so Anchor has no `system_id` for them. The reasons are in
 * docs/biomarkers.md.
 *
 * `sources` are the stored metric stems (keys without their date) that feed a
 * vital, as `infrastructure/format-measure.ts` knows them. The one exception is
 * `google.daily-respiratory-rate`, which is stored but has no label or kind yet.
 *
 * Decisions: HRV → nervous system (brain), with the heart
 * as a secondary link because it is measured there; strain → cardiovascular,
 * because Whoop computes it from heart rate. No wearable here reports stress,
 * so there is no stress row. Composite scores (readiness, recovery, activity)
 * get no system.
 */
import { type SystemId } from "@/packages/anatomy/systems";

export const VITAL_IDS = [
  "heartRate",
  "rhr",
  "hrv",
  "spo2",
  "respiration",
  "sleep",
  "strain",
  "steps",
] as const;

export type VitalId = (typeof VITAL_IDS)[number];

export type VitalAnatomy = Readonly<{
  system: SystemId;
  /** HRA organ-group keys to light; empty means the whole system. */
  hraGroups: readonly string[];
  /** A second, weaker link (HRV is measured at the heart). */
  secondaryHraGroups: readonly string[];
  sources: readonly string[];
  note: string;
}>;

export const VITAL_ANATOMY: Readonly<Record<VitalId, VitalAnatomy>> = {
  heartRate: {
    system: "cardiovascular",
    hraGroups: ["heart"],
    secondaryHraGroups: [],
    sources: ["sleep.hr", "whoop.cycle.avg_hr", "google.heart-rate"],
    note: "Heart rate",
  },
  rhr: {
    system: "cardiovascular",
    hraGroups: ["heart"],
    secondaryHraGroups: [],
    sources: ["whoop.recovery.rhr", "google.daily-resting-heart-rate"],
    note: "Resting heart rate",
  },
  hrv: {
    system: "nervous",
    hraGroups: ["brain"],
    secondaryHraGroups: ["heart"],
    sources: ["sleep.hrv", "whoop.recovery.hrv", "google.daily-heart-rate-variability"],
    note: "Reflects autonomic regulation, measured from beat-to-beat timing at the heart",
  },
  spo2: {
    system: "respiratory",
    hraGroups: ["lung"],
    secondaryHraGroups: [],
    sources: [
      "whoop.recovery.spo2",
      "google.oxygen-saturation",
      "google.daily-oxygen-saturation",
    ],
    note: "Blood oxygen saturation",
  },
  respiration: {
    system: "respiratory",
    hraGroups: ["lung", "trachea"],
    secondaryHraGroups: [],
    sources: ["google.daily-respiratory-rate"],
    note: "Breathing rate; only Google Health reports it",
  },
  sleep: {
    system: "nervous",
    hraGroups: ["brain"],
    secondaryHraGroups: [],
    sources: [
      "sleep.score",
      "sleep.duration",
      "sleep.efficiency",
      "whoop.sleep.performance",
      "whoop.sleep.efficiency",
      "whoop.sleep.consistency",
      "whoop.sleep.in_bed_min",
    ],
    note: "Sleep; open-twin files sleep and recovery under the nervous system",
  },
  strain: {
    system: "cardiovascular",
    hraGroups: [],
    secondaryHraGroups: [],
    sources: ["whoop.cycle.strain"],
    note: "Whoop strain, computed from heart rate",
  },
  steps: {
    system: "musculoskeletal",
    hraGroups: [],
    secondaryHraGroups: [],
    sources: ["activity.steps", "google.steps"],
    note: "Steps; the whole system is shown",
  },
};

/** The vital a stored metric stem feeds, or null when it feeds none. */
export const vitalForStem = (stem: string): VitalId | null =>
  VITAL_IDS.find((id) => VITAL_ANATOMY[id].sources.includes(stem)) ?? null;
