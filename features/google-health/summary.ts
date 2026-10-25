import type { Bundle, Observation } from "fhir/r4";

import { GOOGLE_MEASURE_LABELS } from "@/infrastructure/format-measure";
import type {
  GoogleHealthMetric,
  GoogleHealthSummary,
} from "@/infrastructure/google-health-types";

export type { GoogleHealthMetric, GoogleHealthSummary };

const GOOGLE_HEALTH_ID = "http://opentwin.ch/fhir/sid/google-health";

/** LOINC / vendor codes → stable TwinLLM metric slugs. */
const CODE_TO_MEASURE: Record<string, string> = {
  "55423-8": "steps",
  "41950-7": "steps",
  "40443-4": "heart-rate",
  "8867-4": "heart-rate",
  "59408-5": "oxygen-saturation",
  "2708-6": "oxygen-saturation",
  "29463-7": "weight",
  "39156-5": "body-fat",
  "8302-2": "height",
  steps: "steps",
  distance: "distance",
  "active-minutes": "active-minutes",
  sleep: "sleep",
  "sleep-stage": "sleep-stage",
  "daily-resting-heart-rate": "daily-resting-heart-rate",
  "daily-heart-rate-variability": "daily-heart-rate-variability",
  "daily-oxygen-saturation": "daily-oxygen-saturation",
  "daily-respiratory-rate": "daily-respiratory-rate",
  "daily-vo2-max": "daily-vo2-max",
};

/** Interval samples that should become one daily total in the chat/dashboard. */
const SUM_BY_DAY = new Set([
  "steps",
  "distance",
  "active-minutes",
  "active-energy-burned",
  "basal-energy-burned",
  "floors",
]);

const dayKey = (iso?: string | null) => {
  if (!iso) return "unknown";
  return iso.slice(0, 10);
};

const measureFromObservation = (observation: Observation): string => {
  const identifier = observation.identifier?.find(
    (id) => id.system === GOOGLE_HEALTH_ID,
  )?.value;
  if (identifier?.includes("|")) {
    const slug = identifier.split("|")[0]?.trim();
    if (slug) return CODE_TO_MEASURE[slug] ?? slug;
  }

  const code = observation.code?.coding?.[0]?.code;
  if (code) return CODE_TO_MEASURE[code] ?? code;
  return "observation";
};

const labelFor = (measure: string, fallback?: string): string => {
  return GOOGLE_MEASURE_LABELS[measure] ?? fallback ?? measure;
};

type Agg = {
  measure: string;
  label: string;
  date: string;
  unit?: string;
  values: number[];
  mode: "sum" | "last";
};

/**
 * Flattens Google Health FHIR Observations into citation-friendly metric keys.
 *
 * Fitbit emits dense interval samples (e.g. per-minute steps). We roll those up
 * to daily totals so TwinLLM / Connectors show the same numbers a Fitbit app would.
 */
export const buildGoogleHealthSummary = (
  bundle: Bundle,
  window: { startDate: string; endDate: string },
): GoogleHealthSummary => {
  const aggregates = new Map<string, Agg>();

  for (const entry of bundle.entry ?? []) {
    const resource = entry.resource;
    if (!resource || resource.resourceType !== "Observation") continue;
    const observation = resource as Observation;

    const measure = measureFromObservation(observation);
    const coding = observation.code?.coding?.[0];
    const label = labelFor(measure, coding?.display);
    const date = dayKey(
      observation.effectiveDateTime ?? observation.effectivePeriod?.start ?? null,
    );
    if (date === "unknown") continue;

    const quantity = observation.valueQuantity;
    if (typeof quantity?.value !== "number") {
      // Prefer top-level quantity; skip component floods for chat density.
      continue;
    }

    const key = `${measure}|${date}`;
    const mode = SUM_BY_DAY.has(measure) ? "sum" : "last";
    const existing = aggregates.get(key);
    if (!existing) {
      aggregates.set(key, {
        measure,
        label,
        date,
        unit: quantity.unit ?? quantity.code,
        values: [quantity.value],
        mode,
      });
    } else {
      existing.values.push(quantity.value);
      if (!existing.unit && (quantity.unit || quantity.code)) {
        existing.unit = quantity.unit ?? quantity.code;
      }
    }
  }

  const metrics: GoogleHealthMetric[] = [...aggregates.values()]
    .map((agg) => {
      const value =
        agg.mode === "sum"
          ? Math.round(agg.values.reduce((a, b) => a + b, 0))
          : agg.values[agg.values.length - 1]!;
      return {
        key: `google.${agg.measure}.${agg.date}`,
        label: `${agg.label} (${agg.date})`,
        value,
        date: agg.date,
        unit: agg.unit,
      } satisfies GoogleHealthMetric;
    })
    .sort(
      (a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.key.localeCompare(b.key),
    );

  const preferred = metrics
    .filter(
      (m) =>
        m.key.includes("daily-") ||
        m.key.includes("steps") ||
        m.key.includes("sleep") ||
        m.key.includes("resting-heart-rate") ||
        m.key.includes("heart-rate-variability") ||
        m.key.includes("oxygen-saturation") ||
        m.key.includes("active-minutes") ||
        m.key.includes("distance") ||
        m.key.includes("weight"),
    )
    .slice(0, 80);

  const lines = (preferred.length > 0 ? preferred : metrics.slice(0, 80)).map((m) => {
    const unit = m.unit ? ` ${m.unit}` : "";
    return `- [${m.key}] ${m.label}: ${m.value}${unit}`;
  });

  const narrative =
    metrics.length === 0
      ? "No Google Health metrics were available for this window. Confirm the Google account is linked to Fitbit and that Health API access is enabled for this project."
      : [
          `Google Health (Fitbit-linked) context for ${window.startDate} to ${window.endDate}.`,
          "Interval samples (e.g. minute steps) are summed into daily totals.",
          "Cite metrics by their [key] when they inform your answer.",
          ...lines,
        ].join("\n");

  return { window, metrics, narrative };
};
