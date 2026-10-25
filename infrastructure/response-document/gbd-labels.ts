import type { GbdRow } from "@/packages/gbd-mcp/normalize";

const MEASURE_LABELS: Readonly<Record<string, string>> = {
  deaths: "Deaths",
  dalys: "Disability-adjusted life years (DALYs)",
  yld: "Years lived with disability (YLDs)",
  yll: "Years of life lost (YLLs)",
  prevalence: "Prevalence",
  incidence: "Incidence",
};

const SEX_LABELS: Readonly<Record<string, string>> = {
  both: "Both sexes",
  male: "Male",
  female: "Female",
};

const AGE_LABELS: Readonly<Record<string, string>> = {
  all_ages: "All ages",
  age_standardized: "Age-standardised",
};

/** IHME metric codes as they may arrive in `unit`; anything else is shown as given. */
const METRIC_LABELS: Readonly<Record<string, string>> = {
  rate: "per 100,000",
  number: "people",
  percent: "%",
};

const label = (labels: Readonly<Record<string, string>>, code: string): string =>
  labels[code.trim().toLowerCase()] ?? code;

const withUnit = (value: number, unit: string): string => {
  if (!unit) return String(value);
  const metric = label(METRIC_LABELS, unit);
  return metric === "%" ? `${value}%` : `${value} ${metric}`;
};

export type GbdRowLabel = Pick<
  GbdRow,
  | "measure"
  | "cause"
  | "location"
  | "year"
  | "sex"
  | "age"
  | "value"
  | "lower"
  | "upper"
  | "unit"
>;

/**
 * One population-context row in plain words, e.g.
 * "Deaths · Cardiovascular diseases · Switzerland · 2021 · Both sexes · All ages ·
 * 12.5 per 100,000 (uncertainty interval 10–15)". The interval is shown only
 * when both bounds are present.
 */
export const formatGbdRow = (row: GbdRowLabel): string => {
  const interval =
    row.lower !== null && row.upper !== null
      ? ` (uncertainty interval ${row.lower}–${row.upper})`
      : "";
  return [
    label(MEASURE_LABELS, row.measure),
    row.cause,
    row.location,
    row.year,
    label(SEX_LABELS, row.sex),
    label(AGE_LABELS, row.age),
    `${withUnit(row.value, row.unit)}${interval}`,
  ].join(" · ");
};
