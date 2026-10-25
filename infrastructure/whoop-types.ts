/**
 * Whoop summary shapes — parallel to Oura types for evidence attribution.
 */

export type WhoopMetric = Readonly<{
  key: string;
  label: string;
  value: string | number;
  date?: string;
  unit?: string;
}>;

export type WhoopSummary = Readonly<{
  window: { startDate: string; endDate: string };
  metrics: readonly WhoopMetric[];
  narrative: string;
}>;
