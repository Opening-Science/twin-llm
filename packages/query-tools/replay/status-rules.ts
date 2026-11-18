import { DAY_THRESHOLDS, type DayThresholds, type GlucoseProfile } from "../day-beats";
import { type Origin } from "./items";

/**
 * Usual, Notable and Worth a look: the words a phase or a night shows, each
 * with the rule that gave it and the evidence it used. Pure, free of I/O.
 *
 * No rule here is approved for recorded data yet. The thresholds are
 * placeholders from `day-thresholds.json` until Robin confirms them, and the
 * other rules come from the mock-up. So a recorded day is never classified:
 * its status is "Not classified", with the reason, until a rule's id is
 * added to `APPROVED_FOR_RECORDED`; "Not enough data" still shows, since it
 * judges nothing. Synthetic demonstrations show every rule.
 *
 * Without enough data a status is "Not enough data", never Usual.
 */

export const STATUSES = [
  "usual",
  "notable",
  "worth_a_look",
  "insufficient_data",
  "not_classified",
] as const;
export type Status = (typeof STATUSES)[number];

/** The words shown with a status, so it never rests on colour alone. */
export const STATUS_WORDS: Readonly<Record<Status, string>> = {
  usual: "Usual",
  notable: "Notable",
  worth_a_look: "Worth a look",
  insufficient_data: "Not enough data",
  not_classified: "Not classified",
};

/**
 * Where a rule comes from: a placeholder threshold waiting for review, or
 * the mock-up, for demonstrations only.
 */
export type RuleBasis = "placeholder_threshold" | "demo_only";

export type StatusRule = Readonly<{ id: string; text: string; basis: RuleBasis }>;

/** Rule ids approved for recorded data. Empty until a reviewer approves one. */
export const APPROVED_FOR_RECORDED: readonly string[] = [];

export type StatusResult = Readonly<{
  status: Status;
  words: string;
  rule: StatusRule;
  /** Ids of the items the status rests on. */
  evidence: readonly string[];
  /** One sentence on why: the numbers compared, or what is missing. */
  reason: string;
}>;

/** What a rule found, before the origin decides whether it may be shown. */
export type RuleOutcome = Readonly<{
  status: Exclude<Status, "not_classified">;
  evidence: readonly string[];
  reason: string;
}>;

/** A rule's outcome as shown: on recorded data, only an approved rule classifies. */
export const decide = (
  origin: Origin,
  rule: StatusRule,
  outcome: RuleOutcome,
): StatusResult => {
  // Not enough data is a fact about the data, not a judgement: it stands on any origin.
  const allowed =
    origin === "synthetic_demo" ||
    outcome.status === "insufficient_data" ||
    APPROVED_FOR_RECORDED.includes(rule.id);
  const status = allowed ? outcome.status : "not_classified";
  return {
    status,
    words: STATUS_WORDS[status],
    rule,
    evidence: outcome.evidence,
    reason: allowed
      ? outcome.reason
      : "This rule is not approved for recorded data yet, so it is shown on synthetic demonstrations only.",
  };
};

/** Heart rate past the still threshold while still: a placeholder for Robin. */
export const heartStillRule = (
  thresholds: DayThresholds = DAY_THRESHOLDS,
): StatusRule => ({
  id: "heart_rate_still_above",
  text: `Heart rate above ${thresholds.heartRateStillAbovePerMin} /min with no movement recorded is worth a look (placeholder, for Robin to confirm).`,
  basis: "placeholder_threshold",
});

export const HEART_NOT_JUDGED: StatusRule = {
  id: "heart_rate_activity_not_judged",
  text: "Heart rate while waking, walking, running or winding down is expected to change and is not judged by its height.",
  basis: "demo_only",
};

export const HEART_NEAR_BASELINE: StatusRule = {
  id: "heart_rate_near_resting_baseline",
  text: "Asleep or resting, heart rate within 10 /min of the personal resting baseline is usual; higher is notable.",
  basis: "demo_only",
};

export const HEART_RECOVERY: StatusRule = {
  id: "heart_rate_recovery_within_hour",
  text: "After a walk or run, heart rate back within the recovery band within an hour is usual; later is notable.",
  basis: "demo_only",
};

/** Glucose past the profile's placeholder threshold. */
export const glucoseThresholdRule = (
  profile: GlucoseProfile,
  thresholds: DayThresholds = DAY_THRESHOLDS,
): StatusRule => {
  const [low, high] = thresholds.glucoseWithDiabetesRangeMgDl;
  return {
    id: "glucose_past_threshold",
    text:
      profile === "without_diabetes"
        ? `Glucose above ${thresholds.glucoseWithoutDiabetesAboveMgDl} mg/dL is worth a look; at or below it is usual (placeholder, without diabetes).`
        : `Glucose outside ${low}–${high} mg/dL is worth a look; inside it is usual (placeholder consensus range, with diabetes).`,
    basis: "placeholder_threshold",
  };
};

/** The rise after a meal that is notable while still under the threshold. */
export const MEAL_RISE_NOTABLE_MG_DL = 30;

export const GLUCOSE_MEAL_RISE: StatusRule = {
  id: "glucose_meal_rise",
  text: `After a meal, a rise of ${MEAL_RISE_NOTABLE_MG_DL} mg/dL or more that stays under the threshold is notable; a smaller rise is usual.`,
  basis: "demo_only",
};

/** True when a glucose value is past the profile's threshold, and on which side. */
export const glucosePast = (
  value: number,
  profile: GlucoseProfile,
  thresholds: DayThresholds = DAY_THRESHOLDS,
): "above" | "below" | null => {
  if (profile === "without_diabetes") {
    return value > thresholds.glucoseWithoutDiabetesAboveMgDl ? "above" : null;
  }
  const [low, high] = thresholds.glucoseWithDiabetesRangeMgDl;
  return value < low ? "below" : value > high ? "above" : null;
};
