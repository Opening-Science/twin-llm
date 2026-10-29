/**
 * What a subject's Synthea conditions do to their synthetic wearable days
 * (generator v3).
 *
 * Every effect size here is a stated assumption or a direction taken from the
 * literature, listed with its source in docs/training-data.md ("Condition
 * effects"). None is fitted to a device or a person. An effect starts on the
 * onset day and, except for stroke, ends the day the condition abates.
 * Hypertension has no wearable effect on purpose: a wrist device does not
 * measure blood pressure.
 *
 * Every v3 subject gets the same metrics: nightly SpO2 mean and minimum, an
 * irregular-rhythm notification count (with rare false positives) and the AF
 * burden (0 without AF). Only the values follow the conditions, so the
 * presence of a metric never tells a condition.
 *
 * Pure: per-day randomness comes from a hash of the subject key, the label and
 * the day, so any day can be computed alone and nothing touches the v2 random
 * streams.
 */
import { hash32, mulberry32 } from "./random";

export const SNOMED_SYSTEM = "http://snomed.info/sct";

export type ConditionKind =
  "atrial_fibrillation" | "heart_failure" | "stroke" | "sleep_apnea";

export const CONDITION_KINDS: readonly ConditionKind[] = [
  "atrial_fibrillation",
  "heart_failure",
  "stroke",
  "sleep_apnea",
];

/** SNOMED CT codes Synthea writes for each condition with a wearable effect. */
export const CONDITION_CODES: Readonly<Record<ConditionKind, readonly string[]>> = {
  atrial_fibrillation: ["49436004"],
  heart_failure: ["88805009", "84114007"],
  stroke: ["230690007"],
  sleep_apnea: ["78275009", "73430006"],
};

export type SubjectCondition = Readonly<{
  kind: ConditionKind;
  /** First day with the effect, YYYY-MM-DD (UTC). */
  onset: string;
  /** First day without it, or null while the condition is active. */
  abatement: string | null;
}>;

export type DayEffects = Readonly<{
  /** Added to the resting heart rate, /min. */
  restingHrDelta: number;
  /** Added to the daily mean heart rate on top of the resting change, /min. */
  heartRateDelta: number;
  /** Multiplies RMSSD (heart failure lowers it). */
  hrvFactor: number;
  /** Multiplies RMSSD after the sleep score is set (an irregular rhythm inflates it). */
  irregularHrvFactor: number;
  stepsFactor: number;
  sleepScoreDelta: number;
  respirationDelta: number;
  /** Share of the day in atrial fibrillation (simulator ground truth); null only in v2. */
  afBurden: number | null;
  /** Irregular-rhythm notifications that day; null only in v2. */
  irregularRhythmNotifications: number | null;
  /** Nightly SpO2 in %; null only in v2. */
  spo2: Readonly<{ mean: number; min: number }> | null;
}>;

/** The v2 day: no condition and none of the v3 metrics. */
export const NO_EFFECTS: DayEffects = {
  restingHrDelta: 0,
  heartRateDelta: 0,
  hrvFactor: 1,
  irregularHrvFactor: 1,
  stepsFactor: 1,
  sleepScoreDelta: 0,
  respirationDelta: 0,
  afBurden: null,
  irregularRhythmNotifications: null,
  spo2: null,
};

/**
 * Assumption: about one false irregular-rhythm notification per person-year
 * outside AF. False positives exist (Perez et al. 2019; Lubitz et al. 2022);
 * the rate is ours.
 */
const FALSE_NOTIFICATIONS_PER_DAY = 1 / 365;

/** Assumption: an atrial fibrillation episode starts on about one day in ten. */
const AF_EPISODE_START_SHARE = 0.1;
/** Assumption: an episode lasts one to three days. */
const AF_MAX_EPISODE_DAYS = 3;

const DAY_MS = 86_400_000;

const addDays = (day: string, offset: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + offset * DAY_MS).toISOString().slice(0, 10);

const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/**
 * A stable number in [0, 1) for a subject key, a label and an optional day.
 * The hash goes through mulberry32 once: FNV-1a alone barely moves its top
 * bits when only the last characters (the day) change.
 */
const draw = (key: string, label: string, day = ""): number =>
  mulberry32(hash32(`${key}:${label}:${day}`))();

const round = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const activeOn = (condition: SubjectCondition, day: string): boolean =>
  day >= condition.onset && (condition.abatement === null || day < condition.abatement);

/** The share of the day in atrial fibrillation; 0 outside an episode. */
const afBurdenOn = (key: string, onset: string, day: string): number => {
  const covering = Array.from({ length: AF_MAX_EPISODE_DAYS }, (_, back) => {
    const start = addDays(day, -back);
    if (start < onset || draw(key, "af-start", start) >= AF_EPISODE_START_SHARE) {
      return false;
    }
    const length = 1 + Math.floor(draw(key, "af-length", start) * AF_MAX_EPISODE_DAYS);
    return back < length;
  });
  return covering.some(Boolean) ? round(0.2 + 0.7 * draw(key, "af-burden", day), 2) : 0;
};

const afEffects = (key: string, onset: string, day: string): Partial<DayEffects> => {
  const burden = afBurdenOn(key, onset, day);
  // A day outside an episode keeps the baseline (burden 0, rare false positives).
  if (burden === 0) return {};
  return {
    afBurden: burden,
    // Short or low-burden episodes often go without a notification.
    irregularRhythmNotifications: burden >= 0.7 ? 2 : burden >= 0.35 ? 1 : 0,
    heartRateDelta: 10 + 10 * draw(key, "af-hr", day),
    irregularHrvFactor: 1 + 2 * burden,
  };
};

const heartFailureEffects = (key: string): Partial<DayEffects> => ({
  restingHrDelta: 5 + 5 * draw(key, "hf-resting"),
  hrvFactor: 0.7 + 0.1 * draw(key, "hf-hrv"),
  stepsFactor: 0.6 + 0.1 * draw(key, "hf-steps"),
});

/** Steps fall to 40% at onset and recover to about 80% over some 90 days. */
const strokeEffects = (onset: string, day: string): Partial<DayEffects> => {
  const fade = Math.exp(-daysBetween(onset, day) / 30);
  return { stepsFactor: 0.8 - 0.4 * fade, sleepScoreDelta: -5 - 7 * fade };
};

const sleepApneaEffects = (key: string, day: string): Partial<DayEffects> => ({
  respirationDelta: 0.5 + 0.5 * draw(key, "osa-resp"),
  spo2: {
    mean: round(92.5 + 2.5 * draw(key, "osa-spo2-mean", day), 1),
    min: Math.round(80 + 8 * draw(key, "osa-spo2-min", day)),
  },
});

/**
 * A v3 day without any condition: normal nightly SpO2, no AF and, rarely, a
 * false irregular-rhythm notification.
 */
export const baselineDay = (day: string, key = ""): DayEffects => ({
  ...NO_EFFECTS,
  afBurden: 0,
  irregularRhythmNotifications:
    draw(key, "irn-false", day) < FALSE_NOTIFICATIONS_PER_DAY ? 1 : 0,
  spo2: {
    mean: round(95 + 3 * draw(key, "spo2-mean", day), 1),
    min: Math.round(89 + 5 * draw(key, "spo2-min", day)),
  },
});

const combine = (total: DayEffects, part: Partial<DayEffects>): DayEffects => ({
  restingHrDelta: total.restingHrDelta + (part.restingHrDelta ?? 0),
  heartRateDelta: total.heartRateDelta + (part.heartRateDelta ?? 0),
  hrvFactor: total.hrvFactor * (part.hrvFactor ?? 1),
  irregularHrvFactor: total.irregularHrvFactor * (part.irregularHrvFactor ?? 1),
  stepsFactor: total.stepsFactor * (part.stepsFactor ?? 1),
  sleepScoreDelta: total.sleepScoreDelta + (part.sleepScoreDelta ?? 0),
  respirationDelta: total.respirationDelta + (part.respirationDelta ?? 0),
  afBurden: part.afBurden ?? total.afBurden,
  irregularRhythmNotifications:
    part.irregularRhythmNotifications ?? total.irregularRhythmNotifications,
  spo2: part.spo2 ?? total.spo2,
});

/**
 * Each kind once: the earliest onset wins, and a stroke is the most recent one,
 * since its effect fades from the onset.
 */
const byKind = (conditions: readonly SubjectCondition[]): SubjectCondition[] =>
  CONDITION_KINDS.flatMap((kind) => {
    const matching = conditions
      .filter((condition) => condition.kind === kind)
      .toSorted((a, b) => a.onset.localeCompare(b.onset));
    const chosen = kind === "stroke" ? matching.at(-1) : matching[0];
    return chosen ? [chosen] : [];
  });

/**
 * The modifiers and v3 metric values for one day, starting from
 * `baselineDay`. `key` makes the per-subject and per-day draws
 * the subject's own (the generator passes seed and subject id). A stroke's
 * abatement is ignored: Synthea closes the acute event within days, while
 * the change in activity lasts.
 */
export const conditionEffects = (
  conditions: readonly SubjectCondition[],
  day: string,
  key = "",
): DayEffects =>
  byKind(conditions)
    .filter((condition) =>
      condition.kind === "stroke" ? day >= condition.onset : activeOn(condition, day),
    )
    .map((condition): Partial<DayEffects> => {
      switch (condition.kind) {
        case "atrial_fibrillation":
          return afEffects(key, condition.onset, day);
        case "heart_failure":
          return heartFailureEffects(key);
        case "stroke":
          return strokeEffects(condition.onset, day);
        case "sleep_apnea":
          return sleepApneaEffects(key, day);
      }
    })
    .reduce(combine, baselineDay(day, key));

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const kindOf = (code: unknown): ConditionKind | null =>
  CONDITION_KINDS.find((kind) => CONDITION_CODES[kind].includes(String(code))) ?? null;

const dayOf = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString().slice(0, 10);
};

/**
 * The conditions with a wearable effect in a Synthea bundle, with onset and
 * abatement days. Other conditions (hypertension among them) are left out.
 */
export const syntheaConditionsOf = (bundle: unknown): SubjectCondition[] => {
  if (!isObject(bundle) || !Array.isArray(bundle.entry)) return [];
  return bundle.entry.flatMap((entry: unknown): SubjectCondition[] => {
    const resource = isObject(entry) ? entry.resource : undefined;
    if (!isObject(resource) || resource.resourceType !== "Condition") return [];
    const code = isObject(resource.code) ? resource.code.coding : undefined;
    const kind = (Array.isArray(code) ? code : [])
      .filter(isObject)
      .filter((coding) => coding.system === SNOMED_SYSTEM)
      .map((coding) => kindOf(coding.code))
      .find((item): item is ConditionKind => item !== null);
    const onset = dayOf(resource.onsetDateTime);
    if (!kind || onset === null) return [];
    return [{ kind, onset, abatement: dayOf(resource.abatementDateTime) }];
  });
};
