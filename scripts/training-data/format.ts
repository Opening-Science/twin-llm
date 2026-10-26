/**
 * How the training answers write numbers, units and dates. Numbers go through
 * `infrastructure/format-measure.ts` (en-GB, half away from zero), so a
 * training answer reads like a TwinLLM answer. Pure.
 */
import { formatDate, formatNumber, roundTo } from "../../infrastructure/format-measure";

/** UCUM codes as a reader sees them; anything else is printed as UCUM. */
const UNIT_TEXT: Readonly<Record<string, string>> = {
  "{steps}/d": "steps/day",
  "{score}": "points",
  "mm[Hg]": "mmHg",
  "kg/m2": "kg/m²",
  "/min": "/min",
};

export const unitText = (ucum: string | null): string =>
  ucum === null ? "" : (UNIT_TEXT[ucum] ?? ucum);

/** A value with its unit: `62 /min`, `5.4%`, `8,813 steps/day`. */
export const formatValue = (
  value: number | null,
  ucum: string | null,
  decimals: number,
): string => {
  const number = formatNumber(value, decimals);
  const unit = unitText(ucum);
  if (unit === "" || value === null || !Number.isFinite(value)) return number;
  return unit === "%" ? `${number}%` : `${number} ${unit}`;
};

/** Enough decimals for two significant digits of a change below 1, at most six. */
export const changeDecimals = (value: number, base: number): number => {
  if (Math.abs(value) >= 1 || value === 0 || !Number.isFinite(value)) return base;
  const needed = Math.ceil(-Math.log10(Math.abs(value))) + 1;
  return Math.min(6, Math.max(base, needed));
};

/** A signed change: `+1.2 kg`, `-0.0035 %`. Zero has no sign. */
export const formatChange = (
  value: number | null,
  ucum: string | null,
  base: number,
): string => {
  if (value === null) return formatValue(null, ucum, base);
  const decimals = changeDecimals(value, base);
  const text = formatValue(value, ucum, decimals);
  return roundTo(value, decimals) > 0 ? `+${text}` : text;
};

/** `16 Oct 2026` from an ISO instant or day. */
export const formatDay = (iso: string | null): string =>
  formatDate(iso === null ? null : iso.slice(0, 10));

export const formatCount = (value: number): string => formatNumber(value, 0);

/** A coverage ratio as a percent; one decimal under 10%, so a few days never read as 0%. */
export const formatShare = (ratio: number): string =>
  `${formatNumber(ratio * 100, ratio > 0 && ratio < 0.1 ? 1 : 0)}%`;
