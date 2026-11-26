import { formatUcumUnit } from "@/infrastructure/format-measure";
import { type ReplayReading } from "@/packages/query-tools/replay/items";

type UnitRule = Readonly<{
  canonical: string;
  scale?: number;
  axis?: "count";
  accent?: "warm";
}>;

const CHART_UNITS = new Map<string, UnitRule>([
  ["/min", { canonical: "/min" }],
  ["/h", { canonical: "/min", scale: 1 / 60 }],
  ["ms", { canonical: "ms" }],
  ["s", { canonical: "ms", scale: 1000 }],
  ["min", { canonical: "min" }],
  ["h", { canonical: "min", scale: 60 }],
  ["steps", { canonical: "steps", axis: "count" }],
  ["{steps}", { canonical: "steps", axis: "count" }],
  ["{steps}/d", { canonical: "steps/day", axis: "count" }],
  ["mg/dL", { canonical: "mg/dL", accent: "warm" }],
  ["g/L", { canonical: "mg/dL", scale: 100, accent: "warm" }],
]);

export function chartUnitFor(unit: string, label: string) {
  const rule = CHART_UNITS.get(unit);
  const canonical = rule?.canonical ?? unit;
  return {
    label: formatUcumUnit(canonical, label) || canonical,
    axis: rule?.axis ?? "continuous",
    accent: rule?.accent ?? "default",
    scale: rule?.scale ?? 1,
  } as const;
}

type Timing = ReplayReading["timing"];
type Presentation = "line" | "points" | "intervals" | "daily-summary" | "nightly-summary";

const PRESENTATION_BY_TIMING = {
  sample: "line",
  observation: "points",
  interval: "intervals",
  day: "daily-summary",
  night: "nightly-summary",
} as const satisfies Record<NonNullable<Timing>, Presentation>;

export function chartPresentation(unit: string, label: string, timing: Timing) {
  return {
    ...chartUnitFor(unit, label),
    // A unit alone does not establish that observations can be joined.
    presentation: timing ? PRESENTATION_BY_TIMING[timing] : "points",
  } as const;
}
