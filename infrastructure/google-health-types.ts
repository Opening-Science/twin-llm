/**
 * Google Health / Fitbit summary shapes — parallel to Oura / Whoop for evidence attribution.
 */

import type { HeldBackNote, SourceRuleNote } from "./wearable-source-rules";

export type GoogleHealthMetric = Readonly<{
  key: string;
  label: string;
  value: string | number;
  date?: string;
  unit?: string;
  /** Why this reading was used over another source's for the same day (#464). */
  sourceRule?: SourceRuleNote;
}>;

export type GoogleHealthSummary = Readonly<{
  window: { startDate: string; endDate: string };
  metrics: readonly GoogleHealthMetric[];
  narrative: string;
  /** Measures and days whose readings were taken out because sources disagree (#464). */
  heldBack?: readonly HeldBackNote[];
}>;
