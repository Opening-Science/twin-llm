/**
 * The relations Synthea v4.0.0 plants, read from its module files and its
 * Framingham calculator (`org.mitre.synthea.modules.calculators.Framingham`,
 * called every month by `CardiovascularDiseaseModule`), and how a recovered
 * rate ratio is judged against them. Pure.
 *
 * What the generator does:
 * - AF onset: `atrial_fibrillation.json` waits month by month on
 *   `atrial_fibrillation_risk`, Framingham's 10-year AF risk from age (45+),
 *   sex, BMI 30+, systolic BP 160+ and whether BP is controlled by
 *   medication. Nothing else.
 * - Stroke onset: `stroke.json` waits on `stroke_risk`, Framingham's 10-year
 *   stroke risk. From age 55 it adds points for systolic BP (with or without
 *   BP medication), smoking, left ventricular hypertrophy, diabetes, coronary
 *   heart disease and AF. Under 55 it uses age and sex rates only. The module runs once.
 * - `coronary_heart_disease` and `left_ventricular_hypertrophy` are read but
 *   never set by any v4.0.0 module or class, so they never add points.
 * - Hypertension raises the systolic BP that both calculators read
 *   (`BloodPressureValueGenerator` reads the `hypertension` attribute).
 * - AF gets warfarin at the next wellness visit (from 1954). No calculator
 *   reads a medication, so anticoagulation cannot lower stroke risk.
 * - Alzheimer's (`dementia.json`): 40% carry the gene, onset at 64 to 80 (5
 *   to 10 years later with high socioeconomic status). No AF, stroke or BP.
 * - Sleep apnea (`sleep_apnea.json`): a share by sex enters the sleep disorder
 *   path (13% of men, 6% of women). Heart failure
 *   and coronary disease only change the device, not the onset.
 */
import { type Topic } from "./codes";
import { type RateRatio } from "./poisson";

export type Planted = "direct" | "indirect" | "none";

export type PlantedRule = Readonly<{
  id: string;
  label: string;
  exposure: Topic;
  outcome: Topic;
  planted: Planted;
  source: string;
  /** Only exposed people at least this old at exposure onset. */
  minAge?: number;
}>;

export const PLANTED_RULES: readonly PlantedRule[] = [
  {
    id: "af-stroke",
    label: "AF then stroke",
    exposure: "af",
    outcome: "stroke",
    planted: "direct",
    source: "Framingham stroke10Year adds AF points from age 55",
  },
  {
    id: "af-stroke-55",
    label: "AF from age 55 then stroke",
    exposure: "af",
    outcome: "stroke",
    planted: "direct",
    source: "as above, only where the AF points apply",
    minAge: 55,
  },
  {
    id: "diabetes-stroke",
    label: "Diabetes then stroke",
    exposure: "diabetes",
    outcome: "stroke",
    planted: "direct",
    source: "Framingham stroke10Year adds diabetes points from age 55",
  },
  {
    id: "hypertension-stroke",
    label: "Hypertension then stroke",
    exposure: "hypertension",
    outcome: "stroke",
    planted: "indirect",
    source: "hypertension raises systolic BP, which stroke10Year reads",
  },
  {
    id: "hypertension-af",
    label: "Hypertension then AF",
    exposure: "hypertension",
    outcome: "af",
    planted: "indirect",
    source:
      "hypertension raises systolic BP and adds BP medication, which atrialFibrillation10Year reads",
  },
  {
    id: "mi-stroke",
    label: "Myocardial infarction then stroke",
    exposure: "vascular",
    outcome: "stroke",
    planted: "none",
    source: "coronary_heart_disease is read by stroke10Year but never set",
  },
  {
    id: "chf-stroke",
    label: "Heart failure then stroke",
    exposure: "heartFailure",
    outcome: "stroke",
    planted: "none",
    source: "no calculator reads heart failure",
  },
  {
    id: "stroke-af",
    label: "Stroke then AF",
    exposure: "stroke",
    outcome: "af",
    planted: "none",
    source: "atrialFibrillation10Year does not read stroke",
  },
  {
    id: "af-dementia",
    label: "AF then Alzheimer's",
    exposure: "af",
    outcome: "dementia",
    planted: "none",
    source: "dementia.json uses age and socioeconomic status only",
  },
  {
    id: "osa-af",
    label: "Sleep apnea then AF",
    exposure: "sleepApnea",
    outcome: "af",
    planted: "none",
    source: "sleep_apnea.json onset depends on sex only; AF risk does not read it",
  },
];

export type Recovered = "raised" | "lowered" | "no clear difference" | "too few events";

export const recoveredOf = (ratio: RateRatio): Recovered => {
  if (ratio === null) return "too few events";
  if (ratio.ci.low > 1) return "raised";
  if (ratio.ci.high < 1) return "lowered";
  return "no clear difference";
};

export type Agreement =
  | "recovered"
  | "not recovered"
  | "consistent with no rule"
  | "association without a direct rule"
  | "undecided";

/**
 * A planted rule is recovered when the rate is raised. With no rule, no clear
 * difference is consistent; a raised or lowered rate is an association that
 * runs through shared inputs (age, sex, blood pressure), not a planted link.
 */
export const agreementOf = (planted: Planted, recovered: Recovered): Agreement => {
  if (recovered === "too few events") return "undecided";
  if (planted === "none") {
    return recovered === "no clear difference"
      ? "consistent with no rule"
      : "association without a direct rule";
  }
  return recovered === "raised" ? "recovered" : "not recovered";
};
