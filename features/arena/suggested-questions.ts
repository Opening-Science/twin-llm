import type {
  CoverageResult,
  WearableCoverageResult,
} from "@/packages/query-tools/tools";

/**
 * Suggested first questions for an empty chat, built from what the subject
 * actually has. Each measure family asks one fixed, neutral question, and only
 * when the coverage read found rows for it, so a chip never asks about data
 * that is not there. No model writes them.
 *
 * Order: families with the most readings first, ties in the order listed
 * below. With 10 or more readings, the busiest family that can be drawn also
 * gets a chart question, after the others. At most five chips; a subject with
 * no rows gets none, because any question would only meet "no data".
 */

export const MAX_SUGGESTIONS = 5;
/** Below this many readings a trend has nothing to fit (`trend` needs 3). */
const TREND_MIN = 3;
/** A chart is offered from this many readings. */
const CHART_MIN = 10;

export type SuggestedQuestion = Readonly<{
  /** What the chip shows. */
  label: string;
  /** What the chip writes into the prompt. */
  prompt: string;
}>;

export type SuggestedQuestions = Readonly<{
  /** Whose data the questions come from, shown above the chips. */
  heading: string;
  questions: readonly SuggestedQuestion[];
}>;

type Phrasing = Readonly<{
  /** Asked with fewer than TREND_MIN readings, or always when there is no trend. */
  latest: string;
  trend?: string;
  chart?: string;
}>;

type CohortFamily = Readonly<{ id: string; loinc: readonly string[] }> & Phrasing;

/** Synthetic subjects, by LOINC. Every code here is read in one coverage call. */
export const COHORT_FAMILIES: readonly CohortFamily[] = [
  {
    id: "heart-rate",
    loinc: ["8867-4"],
    latest: "What was their latest heart rate?",
    trend: "How has their heart rate changed across their records?",
    chart: "Show a chart of their heart rate across their records.",
  },
  {
    id: "blood-pressure",
    loinc: ["8480-6", "8462-4"],
    latest: "What was their latest blood pressure?",
    trend: "How has their blood pressure changed across their records?",
  },
  {
    id: "body-weight",
    loinc: ["29463-7"],
    latest: "What was their latest body weight?",
    trend: "How has their body weight changed across their records?",
    chart: "Show a chart of their body weight across their records.",
  },
  {
    id: "bmi",
    loinc: ["39156-5"],
    latest: "What was their latest BMI?",
    trend: "How has their BMI changed across their records?",
  },
  { id: "hba1c", loinc: ["4548-4"], latest: "What was their latest HbA1c?" },
  { id: "glucose", loinc: ["2339-0"], latest: "What was their latest glucose result?" },
  {
    id: "lipids",
    loinc: ["2093-3", "18262-6", "2085-9", "2571-8"],
    latest: "What were their latest cholesterol and triglyceride results?",
  },
  {
    id: "creatinine",
    loinc: ["2160-0"],
    latest: "What was their latest creatinine result?",
  },
  {
    id: "respiratory-rate",
    loinc: ["9279-1"],
    latest: "What was their latest respiratory rate?",
    trend: "How has their respiratory rate changed across their records?",
  },
  {
    id: "oxygen-saturation",
    loinc: ["59408-5", "2708-6"],
    latest: "What was their latest oxygen saturation?",
  },
];

export const COHORT_SUGGESTION_LOINCS: readonly string[] = COHORT_FAMILIES.flatMap(
  (family) => family.loinc,
);

type WearableFamily = Readonly<{
  id: string;
  /** Matches a key without its date. */
  keys: RegExp;
  latest: string;
  /** `{days}` is the number of days with readings. */
  trend?: string;
  chart?: string;
}>;

/** Linked wearables, by key without its date. */
export const WEARABLE_FAMILIES: readonly WearableFamily[] = [
  {
    id: "resting-heart-rate",
    keys: /^(whoop\.recovery\.rhr|google\.daily-resting-heart-rate)$/,
    latest: "What was my latest resting heart rate?",
    trend: "How has my resting heart rate changed across my {days} days of readings?",
    chart: "Show a chart of my resting heart rate.",
  },
  {
    id: "hrv",
    keys: /^(whoop\.recovery\.hrv|sleep\.hrv(\.[a-z_]+)?|google\.daily-heart-rate-variability)$/,
    latest: "What was my latest HRV?",
    trend: "How has my HRV changed across my {days} days of readings?",
    chart: "Show a chart of my HRV.",
  },
  {
    id: "sleep",
    keys: /^(sleep\.(score|duration|efficiency)(\.[a-z_]+)?|whoop\.sleep\.[a-z_]+|google\.sleep)$/,
    latest: "What do my latest sleep readings show?",
    trend: "How has my sleep changed across my {days} nights of readings?",
  },
  {
    id: "steps",
    keys: /^(activity\.steps|google\.steps)$/,
    latest: "How many steps did I take on my latest day of readings?",
    trend: "How have my daily steps changed across my {days} days of readings?",
    chart: "Show a chart of my daily steps.",
  },
  {
    id: "readiness",
    keys: /^readiness\.score$/,
    latest: "What was my latest readiness score?",
    trend: "How has my readiness score changed across my {days} days of readings?",
  },
  {
    id: "recovery",
    keys: /^whoop\.recovery\.score$/,
    latest: "What was my latest recovery score?",
    trend: "How has my recovery score changed across my {days} days of readings?",
  },
  {
    id: "oxygen-saturation",
    keys: /^(spo2\.average|whoop\.recovery\.spo2|google\.(daily-)?oxygen-saturation)$/,
    latest: "What was my latest blood oxygen reading?",
  },
  {
    id: "workouts",
    keys: /^(whoop\.)?workout\./,
    latest: "Which workouts are in my synced data?",
  },
];

/** The keys of a snapshot that some family asks about, sorted, once each. */
export const wearableSuggestionKeys = (keys: readonly string[]): readonly string[] =>
  [...new Set(keys)]
    .filter((key) => WEARABLE_FAMILIES.some((family) => family.keys.test(key)))
    .sort();

type Counted = Readonly<{ order: number; readings: number; phrasing: Phrasing }>;

/**
 * Families with readings, most first. A family's readings are its busiest
 * member's, so systolic and diastolic from one visit count once.
 */
const ranked = (counted: readonly Counted[]): readonly Counted[] =>
  counted
    .filter((family) => family.readings > 0)
    .sort((a, b) => b.readings - a.readings || a.order - b.order);

const pick = (families: readonly Counted[]): readonly string[] => {
  const charted = families.find(
    (family) => family.phrasing.chart !== undefined && family.readings >= CHART_MIN,
  );
  const perFamily = families
    .slice(0, charted ? MAX_SUGGESTIONS - 1 : MAX_SUGGESTIONS)
    .map((family) =>
      family.phrasing.trend !== undefined && family.readings >= TREND_MIN
        ? family.phrasing.trend
        : family.phrasing.latest,
    );
  return [
    ...new Set([
      ...perFamily,
      ...(charted?.phrasing.chart ? [charted.phrasing.chart] : []),
    ]),
  ];
};

const lowerFirst = (text: string): string =>
  text.length === 0 ? text : `${text[0]?.toLowerCase() ?? ""}${text.slice(1)}`;

/**
 * Questions about one synthetic subject. The chip reads "their …" under a
 * heading naming the person; the prompt names the subject_ref, because the
 * model may only use a subject_ref it is given.
 */
export const cohortSuggestions = (
  subject: Readonly<{ ref: string; label: string }>,
  coverage: CoverageResult,
): SuggestedQuestions => {
  const readingsOf = (loinc: string): number =>
    coverage.codes.find((code) => code.loinc === loinc)?.n ?? 0;
  const families = ranked(
    COHORT_FAMILIES.map((family, order) => ({
      order,
      readings: Math.max(0, ...family.loinc.map(readingsOf)),
      phrasing: family,
    })),
  );
  // The prompt names the codes the subject has, so a small model never has to
  // recall a LOINC (qwen3:4b asked for 88678-4 when it meant 8867-4).
  const codesFor = (label: string): readonly string[] =>
    COHORT_FAMILIES.find((family) =>
      [family.latest, family.trend, family.chart].includes(label),
    )?.loinc.filter((loinc) => readingsOf(loinc) > 0) ?? [];
  return {
    heading: `From ${subject.label}, synthetic`,
    questions: pick(families).map((label) => {
      const codes = codesFor(label);
      return {
        label,
        prompt: `For synthetic subject ${subject.ref}, ${
          codes.length === 0 ? "" : `using LOINC ${codes.join(", ")}, `
        }${lowerFirst(label)}`,
      };
    }),
  };
};

/** Questions about the person's own linked wearables. */
export const wearableSuggestions = (
  coverage: WearableCoverageResult,
): SuggestedQuestions => {
  const families = ranked(
    WEARABLE_FAMILIES.map((family, order) => {
      const days = Math.max(
        0,
        ...coverage.measures
          .filter((measure) => family.keys.test(measure.key))
          .map((measure) => measure.days_with_data),
      );
      const withDays = (text: string | undefined) =>
        text?.replace("{days}", String(days));
      return {
        order,
        readings: days,
        phrasing: {
          latest: family.latest,
          trend: withDays(family.trend),
          chart: family.chart,
        },
      };
    }),
  );
  return {
    heading: "From your linked wearables",
    questions: pick(families).map((label) => ({ label, prompt: label })),
  };
};
