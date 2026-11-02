import { gbdAttributionLine } from "@/packages/gbd-mcp/constants";

/**
 * The local GBD store (#387): GBD 2023 results a person downloaded from IHME's
 * GBD Results Tool and imported with `bun run gbd:import`. Population
 * estimates only; nothing here reads or sends personal data.
 *
 * The ids below are IHME's own codes as they appear in the Results Tool's
 * "ID and name" export. Age ids 22 (All ages) and 27 (Age-standardized) are
 * from IHME_GBD_2023_A4_CONTEXTS_BY_AGE (GBD 2023 data and tools guide).
 * Measure ids 26 (Life expectancy) and 28 (HALE), metric id 5 (Years) and
 * age id 2 (0-6 days) are as the GBD 2023 Results Tool exports them (#394).
 * The tool offers few ages: each further age group is prompt room the
 * smallest chat context does not have (#149).
 */

export const GBD_ESTIMATE_TOOL = "gbd_estimate";
/**
 * A location or cause profile (#403): a fixed sequence of `gbd_estimate`
 * calls assembled into one answer. Offered only to a skill turn that lists it.
 */
export const GBD_PROFILE_TOOL = "gbd_profile";
/** The audit row of a profile's map: which calls it was drawn from. */
export const GBD_PROFILE_MAP_AUDIT_TOOL = "gbd_profile.map";
export const GBD_LOCAL_RELEASE = "2023";
export const GBD_LOCAL_SOURCE = `IHME GBD ${GBD_LOCAL_RELEASE}`;
export const GBD_LOCAL_ATTRIBUTION = gbdAttributionLine(GBD_LOCAL_RELEASE);
/**
 * IHME's citation for GBD 2023 Results Tool data, as the `citation.txt` of a
 * download gives it (#417). A profile shows the imported file's own text when
 * the import recorded one, else this.
 */
export const GBD_LOCAL_CITATION =
  "Global Burden of Disease Collaborative Network. Global Burden of Disease Study 2023 (GBD 2023) Results. Seattle, United States: Institute for Health Metrics and Evaluation (IHME), 2024. Available from https://vizhub.healthdata.org/gbd-results/.";

/**
 * In the order the model sees them: measures of living well first, deaths
 * last, so a question that names no measure starts calm (#394).
 */
export const GBD_MEASURE_IDS = {
  hale: 28,
  life_expectancy: 26,
  dalys: 2,
  yld: 3,
  prevalence: 5,
  incidence: 6,
  yll: 4,
  deaths: 1,
} as const;

/** Life table measures: about no cause, in years, where higher is better. */
export const GBD_LIFE_TABLE_MEASURES: ReadonlySet<GbdMeasure> = new Set([
  "hale",
  "life_expectancy",
]);

export const GBD_METRIC_IDS = { number: 1, percent: 2, rate: 3, years: 5 } as const;

export const GBD_SEX_IDS = { male: 1, female: 2, both: 3 } as const;

/**
 * Each age option and the GBD age ids it reads, the first imported one
 * winning. `at_birth` is a life table value at age 0: GBD 2023 exports HALE
 * and life expectancy by age group, each group's value at its start age, so
 * the youngest group, 2 (0-6 days), holds the value at birth. Older
 * exports start at 28 (<1 year), which also starts at age 0.
 */
export const GBD_AGE_IDS = {
  all_ages: [22],
  age_standardized: [27],
  at_birth: [2, 28],
} as const;

export type GbdMeasure = keyof typeof GBD_MEASURE_IDS;
export type GbdMetric = keyof typeof GBD_METRIC_IDS;
export type GbdSex = keyof typeof GBD_SEX_IDS;
export type GbdAge = keyof typeof GBD_AGE_IDS;

/** What one value means, by metric: the unit the tool reports. */
export const GBD_METRIC_UNITS: Readonly<Record<GbdMetric, string>> = {
  number: "number",
  percent: "percent",
  rate: "per 100,000",
  years: "years",
};

/** The GBD 2023 Results Tool covers 1990 to 2023. */
export const GBD_FIRST_YEAR = 1990;
export const GBD_LAST_YEAR = 2023;
