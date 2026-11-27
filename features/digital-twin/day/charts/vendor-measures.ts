import { type MEASURES } from "@/packages/personal-data/wearable-measure-codes";

const OURA = "http://opentwin.ch/fhir/CodeSystem/oura";
const WHOOP = "http://opentwin.ch/fhir/CodeSystem/whoop";
const GOOGLE = "http://opentwin.ch/fhir/CodeSystem/google-health";
const VITRONIC = "http://opentwin.ch/fhir/CodeSystem/vitronic";

/**
 * Connector code systems. A vendor coding names the statistic when it sits
 * beside a shared LOINC code (WHOOP's resting and cycle-average heart rates
 * are both 8867-4), so it is the reading's identity.
 */
export const VENDOR_SYSTEMS: ReadonlySet<string> = new Set([
  OURA,
  WHOOP,
  GOOGLE,
  VITRONIC,
]);

/**
 * Vendor codes that record a registry measure, matching the fields the export
 * importers (`packages/personal-data/wearable-*.ts`) store under that measure.
 * Unlisted vendor codes, such as sleep-average heart rate or strain, stay
 * separate measurements rather than borrowing a generic LOINC code's entry.
 */
const ALIASES: Readonly<Record<string, Readonly<Record<string, keyof typeof MEASURES>>>> =
  {
    [OURA]: {
      "sleep-average-hrv": "hrvRmssd",
      "sleep-average-breath": "respiratoryRate",
      "spo2-daily-average": "oxygenSaturation",
    },
    [WHOOP]: {
      "recovery-resting-heart-rate": "restingHeartRate",
      "hrv-rmssd": "hrvRmssd",
      "spo2-percentage": "oxygenSaturation",
      "workout-average-heart-rate": "workoutHeartRate",
    },
    [GOOGLE]: {
      "average-heart-rate-variability": "hrvRmssd",
      "heart-rate-variability": "hrvRmssd",
      "standard-deviation": "hrvSdnn",
      "daily-oxygen-saturation": "oxygenSaturation",
      "oxygen-saturation": "oxygenSaturation",
      "daily-respiratory-rate": "respiratoryRate",
      "respiratory-rate-sleep-summary": "respiratoryRate",
    },
  };

export const vendorMeasureKey = (codeSystem: string | null, code: string | null) =>
  codeSystem && code ? ALIASES[codeSystem]?.[code] : undefined;

/**
 * Whole-day records stamped with a full timestamp: Oura writes the wearer's
 * local midnight with their offset, so the record's own date is its day.
 */
const DAILY: Readonly<Record<string, ReadonlySet<string>>> = {
  [OURA]: new Set(["activity-score", "readiness-score"]),
};

export const isDailyRecord = (codeSystem?: string, code?: string) =>
  Boolean(codeSystem && code && DAILY[codeSystem]?.has(code));
