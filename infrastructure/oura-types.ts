/**
 * Shared wearable metric shapes used by Oura sync (server) and Twin answer
 * parsing / evidence UI (client). Lives in infrastructure so features do not
 * import each other for types alone.
 */

export type OuraMetric = Readonly<{
  key: string;
  label: string;
  value: string | number;
  date?: string;
  unit?: string;
}>;

export type OuraSummary = Readonly<{
  window: { startDate: string; endDate: string };
  metrics: readonly OuraMetric[];
  narrative: string;
}>;

export type EvidenceAttribution = Readonly<{
  metricKey: string;
  label: string;
  value: string | number;
  unit?: string;
  observationId?: string;
}>;
