/**
 * CHA2DS2-VASc (Lip et al. 2010, Chest 137:263) as a research descriptor of a
 * synthetic person at atrial fibrillation onset. Pure. It describes who is in
 * a group; it is not a rule for care and is never shown as one.
 */

export type Cha2ds2VascInput = Readonly<{
  ageYears: number;
  female: boolean;
  /** Congestive heart failure on or before the index date. */
  heartFailure: boolean;
  hypertension: boolean;
  diabetes: boolean;
  /** Stroke, transient ischaemic attack or systemic thromboembolism before the index date. */
  strokeOrTia: boolean;
  /** Myocardial infarction, peripheral artery disease or aortic plaque. */
  vascularDisease: boolean;
}>;

/** 0 to 9: CHF 1, hypertension 1, age 75+ 2, diabetes 1, stroke/TIA 2, vascular 1, age 65-74 1, female 1. */
export const cha2ds2Vasc = (input: Cha2ds2VascInput): number => {
  const agePoints = input.ageYears >= 75 ? 2 : input.ageYears >= 65 ? 1 : 0;
  return (
    agePoints +
    (input.heartFailure ? 1 : 0) +
    (input.hypertension ? 1 : 0) +
    (input.diabetes ? 1 : 0) +
    (input.strokeOrTia ? 2 : 0) +
    (input.vascularDisease ? 1 : 0) +
    (input.female ? 1 : 0)
  );
};

export const SCORE_GROUPS = ["0-1", "2-3", "4-5", "6-9"] as const;
export type ScoreGroup = (typeof SCORE_GROUPS)[number];

export const scoreGroup = (score: number): ScoreGroup =>
  score <= 1 ? "0-1" : score <= 3 ? "2-3" : score <= 5 ? "4-5" : "6-9";
