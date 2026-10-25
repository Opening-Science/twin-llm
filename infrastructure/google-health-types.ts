/**
 * Google Health / Fitbit summary shapes — parallel to Oura / Whoop for evidence attribution.
 */

export type GoogleHealthMetric = Readonly<{
  key: string;
  label: string;
  value: string | number;
  date?: string;
  unit?: string;
}>;

export type GoogleHealthSummary = Readonly<{
  window: { startDate: string; endDate: string };
  metrics: readonly GoogleHealthMetric[];
  narrative: string;
}>;
