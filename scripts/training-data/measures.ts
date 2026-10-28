/**
 * The measures the training questions ask about. Pure data.
 *
 * The 81-question evaluation's S6 probe measures (skin temperature, TSH, SpO2,
 * eGFR, RDW, Oura readiness, Whoop recovery, LOINC 99999-9) are included like
 * any other measure, so S6 scores after training measure in-distribution
 * behaviour (docs/training-data.md).
 */
import type {
  ConversionAnalyte,
  ConversionUnit,
} from "../../packages/query-tools/unit-conversions";

export type MeasureSource = "wearable" | "clinical";

export type Measure = Readonly<{
  loinc: string;
  /** The name answers use. */
  label: string;
  decimals: number;
  source: MeasureSource;
  /** Other names a question may use; the label is always one of them. */
  aliases?: readonly string[];
  /** The unit as a reader would name it in a question, when there is one. */
  unit?: string;
}>;

/** Codes from scripts/synthetic-wearables (UTC daily series). */
export const WEARABLE_MEASURES: readonly [Measure, ...Measure[]] = [
  {
    loinc: "8867-4",
    label: "heart rate",
    decimals: 0,
    source: "wearable",
    aliases: ["pulse", "HR"],
    unit: "/min",
  },
  {
    loinc: "40443-4",
    label: "resting heart rate",
    decimals: 0,
    source: "wearable",
    aliases: ["resting HR", "RHR"],
    unit: "/min",
  },
  {
    loinc: "93832-4",
    label: "sleep duration",
    decimals: 0,
    source: "wearable",
    aliases: ["sleep time", "time asleep"],
    unit: "min",
  },
  {
    loinc: "41950-7",
    label: "daily step count",
    decimals: 0,
    source: "wearable",
    aliases: ["steps", "step count"],
    unit: "steps/day",
  },
  {
    loinc: "9279-1",
    label: "respiratory rate",
    decimals: 1,
    source: "wearable",
    aliases: ["breathing rate"],
    unit: "/min",
  },
];

/** Synthea clinic codes; the only pool for a subject without a wearable series. */
export const CLINICAL_MEASURES: readonly [Measure, ...Measure[]] = [
  {
    loinc: "29463-7",
    label: "body weight",
    decimals: 1,
    source: "clinical",
    aliases: ["weight"],
    unit: "kg",
  },
  {
    loinc: "4548-4",
    label: "HbA1c",
    decimals: 1,
    source: "clinical",
    aliases: ["A1c", "glycated haemoglobin"],
    unit: "%",
  },
  {
    loinc: "8480-6",
    label: "systolic blood pressure",
    decimals: 0,
    source: "clinical",
    aliases: ["systolic BP", "systolic pressure"],
    unit: "mmHg",
  },
  {
    loinc: "2093-3",
    label: "total cholesterol",
    decimals: 0,
    source: "clinical",
    aliases: ["cholesterol"],
    unit: "mg/dL",
  },
  {
    loinc: "39156-5",
    label: "BMI",
    decimals: 1,
    source: "clinical",
    aliases: ["body mass index"],
    unit: "kg/m²",
  },
];

/** Every code the data families ask about, wearable first. */
export const MEASURES: readonly [Measure, ...Measure[]] = [
  ...WEARABLE_MEASURES,
  ...CLINICAL_MEASURES,
];

const clinical = (loinc: string, label: string, decimals: number): Measure => ({
  loinc,
  label,
  decimals,
  source: "clinical",
});

/**
 * Codes with a LOINC that Synthea is not expected to write. The question is
 * asked with the right code; if a subject does have rows, the answer reports
 * them like any latest value.
 */
export const ABSENT_MEASURES: readonly [Measure, ...Measure[]] = [
  clinical("2276-4", "ferritin", 0),
  clinical("2143-6", "cortisol", 1),
  clinical("1989-3", "25-hydroxyvitamin D", 0),
  clinical("2132-9", "vitamin B12", 0),
  clinical("2284-8", "folate", 1),
  clinical("1988-5", "C-reactive protein", 1),
  clinical("1884-6", "apolipoprotein B", 0),
  clinical("10835-7", "lipoprotein(a)", 0),
  clinical("13965-9", "homocysteine", 1),
  clinical("33863-2", "cystatin C", 2),
  clinical("2857-1", "PSA", 2),
  clinical("3084-1", "uric acid", 1),
  clinical("19123-9", "magnesium", 1),
  clinical("33762-6", "NT-proBNP", 0),
  clinical("3024-7", "free T4", 2),
  { ...clinical("3016-3", "TSH", 2), aliases: ["thyrotropin"] },
  {
    ...clinical("59408-5", "blood oxygen saturation", 0),
    aliases: ["SpO2", "oxygen saturation"],
    unit: "%",
  },
  clinical("99999-9", "LOINC 99999-9", 1),
];

/**
 * Measures no tool can read in this session: nothing in the cohort or the
 * wearable series carries them. The right answer calls no tool. HRV, the
 * sleep score and training load left this list when `hrv_trend`,
 * `sleep_summary` and `training_load` began to read the synthetic series.
 */
export type NoCodeMeasure = Readonly<{
  label: string;
  why: "not_recorded";
  /** A measure the cohort does have that someone might put in its place. */
  notThis: string | null;
}>;

export const NO_CODE_MEASURES: readonly [NoCodeMeasure, ...NoCodeMeasure[]] = [
  { label: "VO2max", why: "not_recorded", notThis: "heart rate" },
  { label: "skin temperature", why: "not_recorded", notThis: "systolic blood pressure" },
  { label: "wrist temperature", why: "not_recorded", notThis: "heart rate" },
  { label: "sleep efficiency", why: "not_recorded", notThis: "sleep duration" },
  { label: "deep sleep time", why: "not_recorded", notThis: "sleep duration" },
  { label: "REM sleep time", why: "not_recorded", notThis: "sleep duration" },
  { label: "stress score", why: "not_recorded", notThis: "resting heart rate" },
  { label: "body battery", why: "not_recorded", notThis: null },
  { label: "active calories", why: "not_recorded", notThis: "daily step count" },
  { label: "floors climbed", why: "not_recorded", notThis: "daily step count" },
  { label: "core body temperature", why: "not_recorded", notThis: null },
  { label: "body fat percentage", why: "not_recorded", notThis: "BMI" },
  { label: "grip strength", why: "not_recorded", notThis: null },
  { label: "blood alcohol level", why: "not_recorded", notThis: null },
];

/**
 * Vendor keys a user might name. No wearable is linked in the training prompt,
 * so none of them is an available key, and none has a LOINC twin in the
 * synthetic series.
 */
export const WEARABLE_KEYS: readonly [string, ...string[]] = [
  "whoop.strain.day",
  "whoop.recovery.score",
  "oura.readiness.score",
  "whoop.sleep.performance",
  "oura.sleep.efficiency",
  "oura.activity.score",
  "oura.sleep.latency",
  "fitbit.activity.azm",
  "google_health.stress.score",
  "garmin.body_battery",
  "apple.stand_hours",
  "bodyloop.hydration",
];

/**
 * A measure asked for by name and the one it is easy to confuse it with. The
 * answer reads the asked code only and says the neighbour is a different
 * measure.
 */
export type NearMiss = Readonly<{ asked: Measure; neighbour: Measure }>;

const DIASTOLIC = {
  ...clinical("8462-4", "diastolic blood pressure", 0),
  aliases: ["diastolic BP", "diastolic pressure"],
  unit: "mmHg",
} satisfies Measure;
const LDL = { ...clinical("18262-6", "LDL cholesterol", 0), aliases: ["LDL"] };
const HDL = { ...clinical("2085-9", "HDL cholesterol", 0), aliases: ["HDL"] };
const TRIGLYCERIDES = clinical("2571-8", "triglycerides", 0);
const GLUCOSE = { ...clinical("2339-0", "blood glucose", 0), aliases: ["glucose"] };
const HEIGHT = { ...clinical("8302-2", "body height", 1), aliases: ["height"] };
const INSULIN = clinical("20448-7", "insulin", 1);
const HS_CRP = clinical("30522-7", "high-sensitivity CRP", 1);
const APOB = clinical("1884-6", "apolipoprotein B", 0);

const byLoinc = (loinc: string): Measure => {
  const found = [...MEASURES, ...ABSENT_MEASURES].find((item) => item.loinc === loinc);
  if (!found) throw new Error(`no measure ${loinc}`);
  return found;
};

export const NEAR_MISSES: readonly [NearMiss, ...NearMiss[]] = [
  { asked: DIASTOLIC, neighbour: byLoinc("8480-6") },
  { asked: byLoinc("8480-6"), neighbour: DIASTOLIC },
  { asked: LDL, neighbour: byLoinc("2093-3") },
  { asked: HDL, neighbour: byLoinc("2093-3") },
  { asked: TRIGLYCERIDES, neighbour: byLoinc("2093-3") },
  { asked: GLUCOSE, neighbour: byLoinc("4548-4") },
  { asked: HEIGHT, neighbour: byLoinc("29463-7") },
  { asked: byLoinc("40443-4"), neighbour: byLoinc("8867-4") },
  { asked: byLoinc("8867-4"), neighbour: byLoinc("40443-4") },
  { asked: APOB, neighbour: LDL },
  { asked: INSULIN, neighbour: GLUCOSE },
  { asked: HS_CRP, neighbour: byLoinc("1988-5") },
  { asked: byLoinc("3016-3"), neighbour: byLoinc("3024-7") },
  { asked: byLoinc("59408-5"), neighbour: byLoinc("9279-1") },
];

/**
 * Codes Synthea v4 writes in more than one unit, seen in the seed-42 cohort.
 */
export const MIXED_UNIT_MEASURES: readonly [Measure, ...Measure[]] = [
  clinical("5811-5", "urine specific gravity", 3),
  clinical("5803-2", "urine pH", 1),
  clinical("89579-7", "high-sensitivity troponin I", 0),
  { ...clinical("33914-3", "eGFR", 0), aliases: ["estimated GFR"] },
  { ...clinical("788-0", "red cell distribution width", 1), aliases: ["RDW"] },
];

/**
 * A unit a question asks for. The answer never converts by itself: when
 * `convert_unit`'s table holds the pair (`tool`), the reply calls the tool and
 * reports its value, formula and rounding; when it does not (`tool` null), the
 * reply gives the value in the unit it was stored in and says no tool
 * converts it. Only a reading stored in `from` (UCUM) is converted.
 */
export type Conversion = Readonly<{
  measure: Measure;
  from: string;
  /** The unit as the question names it. */
  to: string;
  tool: Readonly<{ analyte: ConversionAnalyte; to: ConversionUnit }> | null;
}>;

const CREATININE = {
  ...clinical("38483-4", "creatinine", 2),
  aliases: ["serum creatinine"],
} satisfies Measure;

const viaTool = (
  measure: Measure,
  from: ConversionUnit,
  analyte: ConversionAnalyte,
  to: ConversionUnit,
  asked: string = to,
): Conversion => ({ measure, from, to: asked, tool: { analyte, to } });

const byHand = (measure: Measure, from: string, to: string): Conversion => ({
  measure,
  from,
  to,
  tool: null,
});

export const CONVERSIONS: readonly [Conversion, ...Conversion[]] = [
  byHand(byLoinc("29463-7"), "kg", "lb"),
  viaTool(byLoinc("4548-4"), "%", "hba1c", "mmol/mol"),
  viaTool(byLoinc("2093-3"), "mg/dL", "total_cholesterol", "mmol/L"),
  viaTool(GLUCOSE, "mg/dL", "glucose", "mmol/L"),
  byHand(byLoinc("93832-4"), "min", "hours"),
  byHand(HEIGHT, "cm", "inches"),
  byHand(byLoinc("8480-6"), "mm[Hg]", "kPa"),
  byHand(byLoinc("8867-4"), "/min", "beats per hour"),
  viaTool(LDL, "mg/dL", "ldl_cholesterol", "mmol/L"),
  viaTool(HDL, "mg/dL", "hdl_cholesterol", "mmol/L"),
  viaTool(TRIGLYCERIDES, "mg/dL", "triglycerides", "mmol/L"),
  viaTool(CREATININE, "mg/dL", "creatinine", "umol/L", "µmol/L"),
];
