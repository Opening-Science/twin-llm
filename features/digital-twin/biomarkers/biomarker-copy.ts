import { type IntervalPosition } from "@/packages/biomarkers/interval-position";
import { type OrganStatus } from "@/packages/biomarkers/organ-map";
import { type VitalId } from "@/packages/biomarkers/vitals";

/**
 * Every user-facing string of the Biomarkers tab, in one place so lint:claims
 * checks them. Positions are neutral: where a value sits against a published
 * range, never whether that is good or bad.
 */
export const BIOMARKERS_TAB = "Biomarkers";
export const VITALS_GROUP = "Vitals";
export const NO_VALUE_SECTION = "Other Anchor biomarkers (no value)";

/** Wearable vitals are not Anchor markers, so they get their own part, and only when there are any. */
export const valueCount = (
  withValues: number,
  anchorTotal: number,
  vitals: number,
): string =>
  `${withValues} with values · ${anchorTotal} in Anchor v3` +
  (vitals > 0 ? ` · ${vitals} wearable vital${vitals === 1 ? "" : "s"}` : "");

export const NO_PUBLISHED_RANGE = "No published range in Anchor v3";
export const RANGE_NOT_CHOSEN = "Published range depends on sex, age or timing";
export const D11_NO_POSITION = "No position: Anchor flags this unit (open-twin D11)";

export const publishedRange = (range: string): string =>
  `Published range ${range} · Anchor v3`;

export const unitMismatch = (unit: string, rangeUnit: string): string =>
  `No position: measured in ${unit}, range in ${rangeUnit}`;

export const POSITION_TEXT: Readonly<
  Record<Exclude<IntervalPosition, "unknown">, string>
> = {
  below: "Below the published range",
  within: "Within the published range",
  above: "Above the published range",
};

/** On an organ's card: the marker furthest from its published range, and where it sits. */
export const organStatusLine = (status: OrganStatus): string =>
  `Range position: ${status.label} · ${POSITION_TEXT[status.position]}`;

/** How the anatomy Highlight select names a highlight a row set. */
export const highlightFromLabel = (kind: "marker" | "vital", label: string): string =>
  `${kind === "vital" ? "From vital" : "From biomarker"}: ${label}`;

export const LAB_SOURCE_LABEL = "Lab values from";
export const COHORT_FAILED = "Could not load synthetic lab values.";
export const LAB_SOURCE_NONE = "None";
export const SYNTHETIC_DATA_LABEL = "Synthetic data";
export const DEMO_LABS_NOTE =
  "Lab values of a synthetic cohort person, not of this body. No sex or age is stored, so ranges that depend on them get no position.";
export const NO_COHORT =
  "No synthetic cohort loaded on this machine, so only the catalogue is listed. Run bun run setup:local to load one.";
export const SELF_NO_LABS = "No lab source yet. Vitals come from connected wearables.";
export const OTHER_NO_LABS =
  "No lab source for this subject; only the catalogue is listed.";
export const SEE_WITH_DEPTH = "Move Depth past the scan to see it.";

export const VITAL_LABEL: Readonly<Record<VitalId, string>> = {
  heartRate: "Heart rate",
  rhr: "Resting heart rate",
  hrv: "Heart rate variability",
  spo2: "Blood oxygen (SpO2)",
  respiration: "Breathing rate",
  sleep: "Sleep",
  strain: "Strain",
  steps: "Steps",
};
