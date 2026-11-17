/**
 * The marker list with the mesh each donor's twin lights: one row per Anchor
 * biomarker, keyed by its LOINC code, and one per open-twin measurement key
 * that feeds a wearable vital. The organ groups come from the tables the
 * Biomarkers tab already uses (`region-anatomy.ts`, `vitals.ts`); the target
 * per donor is what `target3d` finds on that donor's HRA atlas. A marker with
 * no place, or a place the atlas does not model, has an empty target. Nothing
 * is borrowed from a neighbouring organ.
 */
import { target3d, type TwinDonor } from "@/packages/anatomy/atlas-groups";

import { anchorLayer, type AnchorLayer } from "./anchor-layer";
import { markerAnatomy } from "./region-anatomy";
import { VITAL_ANATOMY, type VitalId } from "./vitals";

export type TwinTargetRow = Readonly<{
  /** A LOINC code, or an open-twin measurement key. */
  key: string;
  keyKind: "loinc" | "measurement";
  /** The Anchor marker id, or the vital the measurement feeds. */
  source: string;
  /** HRA group keys on each donor's atlas; empty where it has no mesh. */
  target3d: Readonly<Record<TwinDonor, readonly string[]>>;
}>;

/**
 * open-twin measurement keys (shared, or `<connector>:` owned) and the vital
 * each one feeds. Only keys whose meaning matches the vital one to one.
 */
export const MEASUREMENT_VITALS: Readonly<Record<string, VitalId>> = {
  "heart-rate": "heartRate",
  "sleep-mean-heart-rate": "heartRate",
  "resting-heart-rate": "rhr",
  "google-health:heart-rate-variability": "hrv",
  "google-health:daily-heart-rate-variability": "hrv",
  "oxygen-saturation": "spo2",
  "google-health:daily-oxygen-saturation": "spo2",
  "sleep-mean-respiratory-rate": "respiration",
  "google-health:daily-respiratory-rate": "respiration",
  "total-sleep-time": "sleep",
  "step-count": "steps",
  "daily-step-count": "steps",
};

const targetsOf = (groups: readonly string[]): TwinTargetRow["target3d"] => ({
  male: target3d(groups, "male"),
  female: target3d(groups, "female"),
});

/** The marker list, Anchor biomarkers first in Anchor's order, then measurements. */
export const twinTargetRows = (
  layer: AnchorLayer = anchorLayer,
): readonly TwinTargetRow[] => [
  ...layer.biomarkers.map((marker): TwinTargetRow => ({
    key: marker.loincCode,
    keyKind: "loinc",
    source: marker.id,
    target3d: targetsOf(
      markerAnatomy(marker).targets.flatMap((target) => target.hraGroups),
    ),
  })),
  ...Object.entries(MEASUREMENT_VITALS).map(([key, vital]): TwinTargetRow => ({
    key,
    keyKind: "measurement",
    source: vital,
    target3d: targetsOf(VITAL_ANATOMY[vital].hraGroups),
  })),
];
