/**
 * BodyLoop summary shapes — parallel to Whoop types for evidence attribution.
 * Chat receives citation keys only; the `.glb` never enters the prompt.
 */

export type VitronicMetric = Readonly<{
  key: string;
  label: string;
  value: string | number;
  date?: string;
  unit?: string;
}>;

export type VitronicSummary = Readonly<{
  window: { startDate: string; endDate: string };
  metrics: readonly VitronicMetric[];
  narrative: string;
}>;
