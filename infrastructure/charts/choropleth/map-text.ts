import { formatNumber, withUnit } from "@/infrastructure/format-measure";

import type { MapRegion } from "./ranking";

/**
 * The words of the map: values with their unit, the 95% uncertainty
 * interval, and the line a screen reader hears on a region. Pure.
 */

/** `12.3 per 100,000` or `4.5%`; the number alone without a unit. */
export const valueText = (
  value: number,
  unit: string | null,
  decimals: number,
): string =>
  unit === null || unit === ""
    ? formatNumber(value, decimals)
    : withUnit(formatNumber(value, decimals), unit);

/** `10.1 to 14.2`; null when either bound is missing. */
export const intervalText = (
  lower: number | null,
  upper: number | null,
  decimals: number,
): string | null =>
  lower === null || upper === null
    ? null
    : `${formatNumber(lower, decimals)} to ${formatNumber(upper, decimals)}`;

/** `95% UI 10.1 to 14.2`; null when either bound is missing. */
export const uiText = (
  lower: number | null,
  upper: number | null,
  decimals: number,
): string | null => {
  const interval = intervalText(lower, upper, decimals);
  return interval === null ? null : `95% UI ${interval}`;
};

/** `Lagos, rank 1 of 37: 12.3 per 100,000, 95% UI 10.1 to 14.2`. */
export const regionLabel = (
  region: MapRegion & Readonly<{ rank: number }>,
  total: number,
  unit: string | null,
  decimals: number,
): string => {
  const interval = uiText(region.lower, region.upper, decimals);
  return `${region.name}, rank ${region.rank} of ${total}: ${valueText(region.value, unit, decimals)}${interval === null ? "" : `, ${interval}`}`;
};

/** A legend step: `1.2 to 3.4`, or one number when the bin holds one value. */
export const binText = (from: number, to: number, decimals: number): string =>
  formatNumber(from, decimals) === formatNumber(to, decimals)
    ? formatNumber(from, decimals)
    : `${formatNumber(from, decimals)} to ${formatNumber(to, decimals)}`;

/** Measures where a higher value means people live longer or longer in health. */
const HIGHER_IS_BETTER: ReadonlySet<string> = new Set(["hale", "life_expectancy"]);

/** Burden measures: a higher value means more illness, disability or death. */
const LOWER_IS_BETTER: ReadonlySet<string> = new Set([
  "deaths",
  "dalys",
  "yld",
  "yll",
  "prevalence",
  "incidence",
]);

/**
 * Which way is better for a measure, by its code: higher for HALE and life
 * expectancy, lower for burden measures, null when the measure does not say
 * (#394). The scale is the same either way: a stronger colour is a higher value, in the light and the dark theme.
 */
export const betterDirection = (measure: string): "higher" | "lower" | null => {
  const code = measure.trim().toLowerCase();
  if (HIGHER_IS_BETTER.has(code)) return "higher";
  if (LOWER_IS_BETTER.has(code)) return "lower";
  return null;
};

/** The legend line on direction: `Stronger colour is higher; higher is better`. */
export const directionText = (measure: string): string => {
  const better = betterDirection(measure);
  return better === null
    ? "Stronger colour is higher"
    : `Stronger colour is higher; ${better} is better`;
};
