/**
 * MADE-UP fixtures in the layout of a GBD Results Tool CSV export ("Both"
 * IDs and names). Every value, interval and SDI row here is invented for
 * tests and is NOT an IHME estimate. Location, cause and risk ids follow GBD's
 * coding so the location map can be exercised; the numbers mean nothing.
 */

export const MADE_UP_HEADER =
  "measure_id,measure_name,location_id,location_name,sex_id,sex_name,age_id,age_name,cause_id,cause_name,metric_id,metric_name,year,val,upper,lower";

const line = (
  location: readonly [number, string],
  cause: readonly [number, string],
  year: number,
  val: string,
  upper: string,
  lower: string,
  measure: readonly [number, string] = [1, "Deaths"],
  metric: readonly [number, string] = [3, "Rate"],
  sex: readonly [number, string] = [3, "Both"],
  age: readonly [number, string] = [27, "Age-standardized"],
): string =>
  [
    measure[0],
    measure[1],
    location[0],
    `"${location[1]}"`,
    sex[0],
    sex[1],
    age[0],
    age[1],
    cause[0],
    `"${cause[1]}"`,
    metric[0],
    metric[1],
    year,
    val,
    upper,
    lower,
  ].join(",");

const CVD = [491, "Cardiovascular diseases"] as const;
const ALL = [294, "All causes"] as const;

export const SWITZERLAND = [94, "Switzerland"] as const;
export const GERMANY = [81, "Germany"] as const;
export const USA = [102, "United States of America"] as const;
export const ALABAMA = [523, "Alabama"] as const;
export const ALASKA = [524, "Alaska"] as const;
export const GEORGIA_COUNTRY = [35, "Georgia"] as const;
export const GEORGIA_STATE = [533, "Georgia"] as const;
export const HIGH_SDI = [44635, "High SDI"] as const;
export const LOW_SDI = [44637, "Low SDI"] as const;

/** Made-up cause rows: CVD deaths, rate, both sexes, age-standardised. */
export const MADE_UP_CAUSE_CSV = [
  MADE_UP_HEADER,
  line(SWITZERLAND, CVD, 2021, "100.5", "110.25", "90.75"),
  line(SWITZERLAND, CVD, 2023, "98.25", "108", "88.5"),
  line(GERMANY, CVD, 2021, "150", "165.5", "135.5"),
  line(GERMANY, CVD, 2023, "1.4e2", "155", "125"),
  line(ALABAMA, CVD, 2021, "220", "240", "200"),
  line(ALASKA, CVD, 2021, "120", "130", "110"),
  line(GEORGIA_COUNTRY, CVD, 2021, "300", "330", "270"),
  line(GEORGIA_STATE, CVD, 2021, "210", "230", "190"),
  line(HIGH_SDI, CVD, 2021, "130", "140", "120"),
  line(LOW_SDI, CVD, 2021, "250", "280", "220"),
  line(SWITZERLAND, ALL, 2021, "400", "420", "380"),
  line(SWITZERLAND, CVD, 2021, "12000", "13000", "11000", [1, "Deaths"], [1, "Number"]),
].join("\r\n");

/** A made-up risk factor export: rei and cause columns, attributable DALYs. */
export const MADE_UP_RISK_CSV = [
  "measure_id,measure_name,location_id,location_name,sex_id,sex_name,age_id,age_name,rei_id,rei_name,cause_id,cause_name,metric_id,metric_name,year,val,upper,lower",
  "2,DALYs (Disability-Adjusted Life Years),94,Switzerland,3,Both,22,All ages,107,High systolic blood pressure,294,All causes,3,Rate,2021,800,900,700",
  "2,DALYs (Disability-Adjusted Life Years),94,Switzerland,3,Both,22,All ages,107,High systolic blood pressure,491,Cardiovascular diseases,3,Rate,2021,600,680,520",
].join("\n");
