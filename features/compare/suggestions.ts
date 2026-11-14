/**
 * Starter chips for an empty thread (SERVER-SPEC 3.9): fixed questions,
 * filled in only for measures the person or the synthetic subject has. No
 * model writes them. Pure: the handler does the reads.
 */

export type Suggestion = Readonly<{ label: string; prompt: string }>;

export type Suggestions = Readonly<{ heading: string; questions: readonly Suggestion[] }>;

export const NO_SUGGESTIONS: Suggestions = { heading: "", questions: [] };

export const MAX_SUGGESTIONS = 5;
const TREND_MIN = 3;
const CHART_MIN = 10;

type Family = Readonly<{
  id: string;
  /** Lower case, as it reads mid-sentence. */
  name: string;
  trend: boolean;
  chart: boolean;
}>;

export type CohortFamily = Family & Readonly<{ codes: readonly string[] }>;
export type WearableFamily = Family & Readonly<{ pattern: RegExp }>;

const vital = (id: string, name: string, codes: readonly string[]): CohortFamily => ({
  id,
  name,
  codes,
  trend: true,
  chart: true,
});
const lab = (id: string, name: string, codes: readonly string[]): CohortFamily => ({
  id,
  name,
  codes,
  trend: false,
  chart: false,
});

export const COHORT_FAMILIES: readonly CohortFamily[] = [
  vital("heart-rate", "heart rate", ["8867-4"]),
  vital("blood-pressure", "blood pressure", ["8480-6", "8462-4"]),
  vital("body-weight", "body weight", ["29463-7"]),
  vital("bmi", "BMI", ["39156-5"]),
  lab("hba1c", "HbA1c", ["4548-4"]),
  lab("glucose", "glucose", ["2339-0", "2345-7"]),
  lab("lipids", "cholesterol", ["2093-3", "2085-9", "18262-6", "13457-7", "2571-8"]),
  lab("creatinine", "creatinine", ["2160-0", "38483-4"]),
  vital("respiratory-rate", "respiratory rate", ["9279-1"]),
  vital("oxygen-saturation", "oxygen saturation", ["2708-6", "59408-5"]),
];

const wearable = (
  id: string,
  name: string,
  pattern: RegExp,
  chart = true,
): WearableFamily => ({ id, name, pattern, trend: true, chart });

export const WEARABLE_FAMILIES: readonly WearableFamily[] = [
  wearable(
    "resting-heart-rate",
    "resting heart rate",
    /resting_heart_rate|resting_hr|\brhr\b/i,
  ),
  wearable("hrv", "heart rate variability", /hrv|rmssd/i),
  wearable("sleep", "sleep", /sleep/i),
  wearable("steps", "steps", /steps/i),
  wearable("readiness", "readiness score", /readiness/i, false),
  wearable("recovery", "recovery score", /recovery/i, false),
  wearable("blood-oxygen", "blood oxygen", /spo2|oxygen_saturation|blood_oxygen/i),
  wearable("workouts", "workouts", /workout/i, false),
];

/** The family a stored wearable key belongs to, or null when no chip asks about it. */
export const wearableFamilyOf = (key: string): WearableFamily | null =>
  WEARABLE_FAMILIES.find((family) => family.pattern.test(key)) ?? null;

export const cohortCodes = (): string[] =>
  COHORT_FAMILIES.flatMap((family) => family.codes);

type Counted<F extends Family> = Readonly<{
  family: F;
  readings: number;
  members: readonly string[];
}>;

/** Families with readings, most first; ties keep the listed order. */
const ranked = <F extends Family>(counted: readonly Counted<F>[]): Counted<F>[] =>
  counted
    .map((entry, order) => ({ entry, order }))
    .filter(({ entry }) => entry.readings > 0)
    .sort((a, b) => b.entry.readings - a.entry.readings || a.order - b.order)
    .map(({ entry }) => entry);

type Wording = Readonly<{
  trend: (name: string, readings: number) => string;
  latest: (name: string) => string;
  chart: (name: string) => string;
}>;

const pick = <F extends Family>(
  counted: readonly Counted<F>[],
  words: Wording,
  promptOf: (question: string, entry: Counted<F>) => string,
): Suggestion[] => {
  const order = ranked(counted);
  const chartFamily =
    order.find((entry) => entry.family.chart && entry.readings >= CHART_MIN) ?? null;
  const room = MAX_SUGGESTIONS - (chartFamily === null ? 0 : 1);
  const questions = order.slice(0, room).map((entry) => {
    const label =
      entry.family.trend && entry.readings >= TREND_MIN
        ? words.trend(entry.family.name, entry.readings)
        : words.latest(entry.family.name);
    return { label, prompt: promptOf(label, entry) };
  });
  const chart =
    chartFamily === null
      ? []
      : [
          {
            label: words.chart(chartFamily.family.name),
            prompt: promptOf(words.chart(chartFamily.family.name), chartFamily),
          },
        ];
  const seen = new Set<string>();
  return [...questions, ...chart]
    .filter((question) => {
      if (seen.has(question.label)) return false;
      seen.add(question.label);
      return true;
    })
    .slice(0, MAX_SUGGESTIONS);
};

const lowerFirst = (text: string): string =>
  text === "" ? text : `${text.charAt(0).toLowerCase()}${text.slice(1)}`;

/** Chips about a synthetic subject, from the codes the coverage read found. */
export const cohortSuggestions = (
  subject: Readonly<{ ref: string; label: string }>,
  codes: readonly Readonly<{ loinc: string; n: number }>[],
): Suggestions => {
  const counted = COHORT_FAMILIES.map((family) => {
    const members = codes.filter(
      (code) => family.codes.includes(code.loinc) && code.n > 0,
    );
    return {
      family,
      readings: Math.max(0, ...members.map((member) => member.n)),
      members: members.map((member) => member.loinc),
    };
  });
  const questions = pick(
    counted,
    {
      trend: (name) => `How has their ${name} changed over time?`,
      latest: (name) => `What is their latest ${name}?`,
      chart: (name) => `Show their ${name} as a chart.`,
    },
    (question, entry) =>
      `For synthetic subject ${subject.ref}, using LOINC ${entry.members.join(", ")}, ${lowerFirst(question)}`,
  );
  return questions.length === 0
    ? NO_SUGGESTIONS
    : { heading: `From ${subject.label}, synthetic`, questions };
};

/** Chips about the person's linked wearables, from days with data per key. */
export const wearableSuggestions = (
  measures: readonly Readonly<{ key: string; days_with_data: number }>[],
): Suggestions => {
  const counted = WEARABLE_FAMILIES.map((family) => {
    const members = measures.filter(
      (measure) =>
        wearableFamilyOf(measure.key)?.id === family.id && measure.days_with_data > 0,
    );
    return {
      family,
      readings: Math.max(0, ...members.map((member) => member.days_with_data)),
      members: members.map((member) => member.key),
    };
  });
  const questions = pick(
    counted,
    {
      trend: (name, days) =>
        `How has my ${name} changed over the last ${String(days)} days?`,
      latest: (name) => `What was my latest ${name}?`,
      chart: (name) => `Show my ${name} as a chart.`,
    },
    (question) => question,
  );
  return questions.length === 0
    ? NO_SUGGESTIONS
    : { heading: "From your linked wearables", questions };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The `subject` query parameter, used only when it is a UUID. */
export const requestedSubject = (value: string | null): string | null => {
  const lowered = value?.trim().toLowerCase() ?? "";
  return UUID.test(lowered) ? lowered : null;
};
