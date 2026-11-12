/**
 * Shared wearable metric shapes used by Oura sync (server) and Twin answer
 * parsing / evidence UI (client). Lives in infrastructure so features do not
 * import each other for types alone.
 */
import type { ValueCheck } from "./cited-value-check";
import type { WearableSourceId } from "./wearable-provenance";
import type { HeldBackNote, SourceRuleNote } from "./wearable-source-rules";

export type OuraMetric = Readonly<{
  key: string;
  label: string;
  value: string | number;
  date?: string;
  unit?: string;
  /** Why this reading was used over another source's for the same day (#464). */
  sourceRule?: SourceRuleNote;
}>;

export type OuraSummary = Readonly<{
  window: { startDate: string; endDate: string };
  metrics: readonly OuraMetric[];
  narrative: string;
  /** Measures and days whose readings were taken out because sources disagree (#464). */
  heldBack?: readonly HeldBackNote[];
}>;

export type EvidenceAttribution = Readonly<{
  metricKey: string;
  label: string;
  value: string | number;
  unit?: string;
  observationId?: string;
  /** The wearable that recorded the value (#464); absent on answers stored before. */
  source?: WearableSourceId;
  /** The day the value belongs to, `YYYY-MM-DD`; absent when not known. */
  day?: string;
  /**
   * Why this source's reading was used when another source also recorded the
   * measure that day (#464, `wearable-source-rules.ts`); absent when it was
   * the only one, and on answers stored before.
   */
  sourceRule?: SourceRuleNote;
  /**
   * Whether the number the answer states for this value is the stored reading
   * (#545, `cited-value-check.ts`); absent on answers stored before and on a
   * value that is not a number.
   */
  valueCheck?: ValueCheck;
}>;
