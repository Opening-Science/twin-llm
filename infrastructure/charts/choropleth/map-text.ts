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
