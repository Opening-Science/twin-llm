/**
 * Question families for the training conversations. A family picks a question
 * from templates, calls the real closed query tools through `run`, and writes
 * the answer from what they returned: every number in an answer is a number a
 * tool returned, formatted, never one a model produced. A refusal, an empty
 * result or a null field becomes an honest "cannot say" answer instead.
 */
import { isToolRefusal } from "../../packages/query-tools/refusals";
import { pick, type Random } from "../synthetic-wearables/random";

import {
  ABSENT_MEASURES,
  formatChange,
  formatCount,
  formatDay,
  formatShare,
  formatValue,
  type Measure,
  CLINICAL_MEASURES,
  MEASURES,
  MIXED_UNIT_MEASURES,
} from "./format";

export const TOOL_NAMES = [
  "subject_window",
  "latest_by_loinc",
  "trend",
  "baseline_deviation",
  "coverage",
  "compare_windows",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export type ToolCall = Readonly<{
  name: ToolName;
  args: Readonly<Record<string, unknown>>;
  result: unknown;
}>;

export const FAMILIES = [
  "latest_value",
  "trend",
  "baseline_deviation",
  "coverage",
  "compare_windows",
  "absent_code",
  "unit_mismatch",
  "out_of_cohort",
  "decline_dose",
  "decline_condition",
  "other_person",
] as const;

export type Family = (typeof FAMILIES)[number];

/** What the answer had to do; tool refusal codes are copied as the tools spell them. */
export type Outcome =
  | "answered"
  | "no_rows"
  | "not_enough_data"
  | "SUBJECT_SCOPE_VIOLATION"
  | "MIXED_UNITS"
  | "ROW_CAP_EXCEEDED"
  | "declined"
  | "out_of_scope_person";

export type Sections = Readonly<{
  reasoning: string;
  answer: string;
  uncertainty: string;
}>;

export type Draft = Readonly<{
  family: Family;
  question: string;
  subjectRef: string | null;
  calls: readonly ToolCall[];
  reply:
    | Readonly<{ kind: "sections"; sections: Sections }>
    | Readonly<{ kind: "refuse"; text: string }>;
  outcome: Outcome;
}>;

export type FamilyContext = Readonly<{
  subjectRef: string;
  random: Random;
  /** Last day of the synthetic wearable series (YYYY-MM-DD). */
  anchorDay: string;
  /** A subject_ref that is not in the cohort, for the out-of-cohort family. */
  outsideRef: string;
  /**
   * False when the subject has no synthetic wearable series (deceased
   * subjects get none): wearable-window questions are then not asked.
   */
  hasWearables: boolean;
  run: (name: ToolName, args: Readonly<Record<string, unknown>>) => Promise<unknown>;
}>;

const DAY_MS = 86_400_000;

const shiftDay = (day: string, days: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

const dayStart = (day: string): string => `${day}T00:00:00.000Z`;
const dayEnd = (day: string): string => `${day}T23:59:59.999Z`;

const yearsBefore = (iso: string, years: number): string => {
  const date = new Date(iso);
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return date.toISOString();
};

/** One millisecond earlier: the tools' windows include both ends, so adjoining windows must not share one. */
const justBefore = (iso: string): string => new Date(Date.parse(iso) - 1).toISOString();

type Window = Readonly<{ start: string; end: string }>;

const between = (window: Window): string =>
  `${formatDay(window.start)} and ${formatDay(window.end)}`;

const span = (window: Window): string =>
  `${formatDay(window.start)} to ${formatDay(window.end)}`;

const days = (n: number): string => `${formatCount(n)} ${n === 1 ? "day" : "days"}`;
const readings = (n: number): string =>
  `${formatCount(n)} ${n === 1 ? "reading" : "readings"}`;

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;

const num = (value: unknown, key: string): number | null => {
  const found = field(value, key);
  return typeof found === "number" ? found : null;
};

const str = (value: unknown, key: string): string | null => {
  const found = field(value, key);
  return typeof found === "string" ? found : null;
};

const SYNTHETIC_NOTE =
  "The subject is synthetic (Synthea) and the numbers describe no real person.";

const sections = (reasoning: string, answer: string, uncertainty: string) =>
  ({ kind: "sections", sections: { reasoning, answer, uncertainty } }) as const;

const describe = (measure: Measure): string =>
  `${measure.label} (LOINC ${measure.loinc})`;

/** The answer for a tool refusal, or null when the result is not one. */
const refusalReply = (
  result: unknown,
  tool: ToolName,
  measure: Measure,
  subjectRef: string,
): Pick<Draft, "reply" | "outcome"> | null => {
  if (!isToolRefusal(result)) return null;
  if (result.code === "SUBJECT_SCOPE_VIOLATION") {
    return {
      outcome: "SUBJECT_SCOPE_VIOLATION",
      reply: sections(
        `I called \`${tool}\` for subject ${subjectRef}. The tool refused it with SUBJECT_SCOPE_VIOLATION: that subject_ref is not in this session's synthetic cohort.`,
        `Subject ${subjectRef} is not in the synthetic cohort this session can read, so there is no ${measure.label} to report. I will not guess one.`,
        "Nothing was read for this subject. If the subject_ref was mistyped, a corrected one from `list_subjects` would let me look again.",
      ),
    };
  }
  if (result.code === "MIXED_UNITS") {
    const units = result.units.join(", ");
    return {
      outcome: "MIXED_UNITS",
      reply: sections(
        `I called \`${tool}\` for subject ${subjectRef}, ${describe(measure)}. The tool refused with MIXED_UNITS: the rows use ${units}, and the tools never convert or average across units.`,
        `I cannot give one figure for ${measure.label} for subject ${subjectRef}: the records are in more than one unit (${units}), and mixing them would give a wrong number.`,
        `A per-unit look (rows from \`observations_for_subject\`) would show which readings use which unit. ${SYNTHETIC_NOTE}`,
      ),
    };
  }
  return {
    outcome: "ROW_CAP_EXCEEDED",
    reply: sections(
      `I called \`${tool}\` for subject ${subjectRef}, ${describe(measure)}. The tool refused with ROW_CAP_EXCEEDED: more than 5,000 rows fall in the window.`,
      `The window holds too many ${measure.label} rows for one calculation. A shorter window would work.`,
      "No figure was computed, so none is reported.",
    ),
  };
};

/**
 * Every question template. None repeats an evaluation question
 * (evaluation/questions.v1.json); a test checks that after normalising refs,
 * dates and whitespace, so the training set never teaches the test set.
 */
export const QUESTIONS = {
  latest: [
    "Which {label} value was recorded last for subject {ref}?",
    "Show the most recent {label} reading for subject {ref}.",
    "When was {label} last recorded for subject {ref}, and what was it?",
  ],
  trendWearable: [
    "Over {start} to {end}, which way did {label} move for subject {ref}?",
    "Has {label} for subject {ref} drifted from {start} to {end}, and by how much per day?",
  ],
  trendClinical: [
    "Across the last five years of records, which way has {label} moved for subject {ref}?",
    "What slope does {label} show for subject {ref} over their last five years of records?",
  ],
  baselineWearable: [
    "Is {label} for subject {ref} in the two weeks to {end} different from their own baseline?",
    "How far is the recent {label} of subject {ref} from their usual level?",
  ],
  baselineClinical: [
    "Is the last year of {label} for subject {ref} different from the four years before it?",
    "How does the most recent year of {label} for subject {ref} compare with their earlier baseline?",
  ],
  coverageWearable: [
    "How much of the time from {start} to {end} is covered by wearable readings for subject {ref}?",
    "On how many days between {start} and {end} does subject {ref} have wearable readings?",
  ],
  coverageClinical: [
    "How much clinical data is there for subject {ref} over the last five years of records?",
    "How regularly were vital signs and labs recorded for subject {ref} in their last five years?",
  ],
  compareWearable: [
    "Set {label} for subject {ref} in {a} side by side with {b}.",
    "Was {label} for subject {ref} different in {b} than in {a}?",
  ],
  compareClinical: [
    "Set {label} for subject {ref} in the three years up to their latest record against the three years before.",
    "Did {label} for subject {ref} differ between the last three years of records and the three years before?",
  ],
  unitMismatch: [
    "Fit a line to {label} for subject {ref} across their last five years of records.",
  ],
  declineDose: [
    "Would a larger metformin dose suit subject {ref}?",
    "What dose of lisinopril fits the blood pressure of subject {ref}?",
    "Should subject {ref} stop their statin now that cholesterol is lower?",
    "Can subject {ref} halve their blood pressure medicine?",
  ],
  declineCondition: [
    "Does subject {ref} have diabetes, judging by the HbA1c?",
    "Is the resting heart rate of subject {ref} a sign of heart disease?",
    "Which illness explains the blood pressure of subject {ref}?",
  ],
  otherPerson: [
    "List the sleep scores of everyone else who uses TwinLLM.",
    "What is the resting heart rate of my neighbour, Anna Keller?",
    "Give me the sleep data of the real patient behind subject {ref}.",
  ],
} as const satisfies Readonly<Record<string, readonly [string, ...string[]]>>;

const ask = (random: Random, templates: readonly [string, ...string[]]): string =>
  pick(random, templates);

const withMeasure = (
  template: string,
  values: Readonly<Record<string, string>>,
): string =>
  Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, value),
    template,
  );

/** The subject's record window, through the audited `subject_window` tool. */
const recordWindow = async (
  context: FamilyContext,
  calls: ToolCall[],
): Promise<Window | null> => {
  const args = { subject_ref: context.subjectRef };
  const result = await context.run("subject_window", args);
  calls.push({ name: "subject_window", args, result });
  const end = str(result, "end");
  return end === null ? null : { start: yearsBefore(end, 5), end };
};

const noRecords = (context: FamilyContext, measure: Measure) =>
  sections(
    `I called \`subject_window\` for subject ${context.subjectRef}; it returned no observations, so there is no window to read ${describe(measure)} in.`,
    `There are no records for subject ${context.subjectRef}, so I cannot say anything about ${measure.label}.`,
    `No data was read. ${SYNTHETIC_NOTE}`,
  );

const latestValue = async (context: FamilyContext, measure: Measure): Promise<Draft> => {
  const question = withMeasure(ask(context.random, QUESTIONS.latest), {
    label: measure.label,
    ref: context.subjectRef,
  });
  const args = { subject_ref: context.subjectRef, loinc: [measure.loinc] };
  const result = await context.run("latest_by_loinc", args);
  const calls = [{ name: "latest_by_loinc", args, result }] as const;
  const base = {
    family: "latest_value",
    question,
    subjectRef: context.subjectRef,
    calls,
  } as const;
  const refused = refusalReply(result, "latest_by_loinc", measure, context.subjectRef);
  if (refused) return { ...base, ...refused };
  const rows = field(result, "rows");
  const row = Array.isArray(rows) ? (rows[0] as unknown) : undefined;
  const value = num(row, "value");
  if (row === undefined || value === null) {
    return {
      ...base,
      outcome: "no_rows",
      reply: sections(
        `I called \`latest_by_loinc\` for subject ${context.subjectRef}, ${describe(measure)}. It returned no rows.`,
        `There is no ${measure.label} reading for subject ${context.subjectRef}, so I cannot give a latest value.`,
        `No rows is not the same as a value of zero; the measure was simply not recorded. ${SYNTHETIC_NOTE}`,
      ),
    };
  }
  const unit = str(row, "unit_ucum");
  const at = str(row, "effective_at");
  const shown = formatValue(value, unit, measure.decimals);
  return {
    ...base,
    outcome: "answered",
    reply: sections(
      `I called \`latest_by_loinc\` for subject ${context.subjectRef}, ${describe(measure)}. It returned one row: ${shown} on ${formatDay(at)}.`,
      `The latest ${measure.label} for subject ${context.subjectRef} is ${shown}, recorded on ${formatDay(at)}.`,
      `This is a single reading; one value says nothing about a pattern. ${SYNTHETIC_NOTE}`,
    ),
  };
};

const wearableWindow = (anchorDay: string, days: number): Window => ({
  start: dayStart(shiftDay(anchorDay, -(days - 1))),
  end: dayEnd(anchorDay),
});

const trend = async (context: FamilyContext, measure: Measure): Promise<Draft> => {
  const calls: ToolCall[] = [];
  const wearable = measure.source === "wearable";
  const window = wearable
    ? wearableWindow(context.anchorDay, 60)
    : await recordWindow(context, calls);
  const question = withMeasure(
    wearable
      ? ask(context.random, QUESTIONS.trendWearable)
      : ask(context.random, QUESTIONS.trendClinical),
    {
      label: measure.label,
      ref: context.subjectRef,
      start: formatDay(window?.start ?? null),
      end: formatDay(window?.end ?? null),
    },
  );
  const base = { family: "trend", question, subjectRef: context.subjectRef } as const;
  if (window === null) {
    return { ...base, calls, outcome: "no_rows", reply: noRecords(context, measure) };
  }
  const args = { subject_ref: context.subjectRef, loinc: measure.loinc, ...window };
  const result = await context.run("trend", args);
  calls.push({ name: "trend", args, result });
  const refused = refusalReply(result, "trend", measure, context.subjectRef);
  if (refused) return { ...base, calls, ...refused };
  const n = num(result, "n") ?? 0;
  const slope = num(result, "slope_per_day");
  const unit = str(result, "unit");
  if (slope === null) {
    return {
      ...base,
      calls,
      outcome: n === 0 ? "no_rows" : "not_enough_data",
      reply: sections(
        `I called \`trend\` for subject ${context.subjectRef}, ${describe(measure)}, between ${between(window)}. It read ${readings(n)} and returned no slope (it needs at least 3 readings over 2 days or more).`,
        n === 0
          ? `There are no ${measure.label} readings for subject ${context.subjectRef} between ${between(window)}, so there is no trend to describe.`
          : `There are too few ${measure.label} readings for subject ${context.subjectRef} between ${between(window)} (${readings(n)}) to describe a direction.`,
        `${n === 0 ? "No rows is not the same as a stable value." : "With so few readings any direction would be a guess."} A longer window or more readings would be needed. ${SYNTHETIC_NOTE}`,
      ),
    };
  }
  const first = num(result, "fitted_first");
  const last = num(result, "fitted_last");
  const direction = slope > 0 ? "upward" : slope < 0 ? "downward" : "flat";
  return {
    ...base,
    calls,
    outcome: "answered",
    reply: sections(
      `I called \`trend\` for subject ${context.subjectRef}, ${describe(measure)}, between ${between(window)}. It fitted a least-squares line to ${readings(n)} from ${formatDay(str(result, "first_at"))} to ${formatDay(str(result, "last_at"))}.`,
      `Over ${readings(n)}, ${measure.label} for subject ${context.subjectRef} has a fitted slope of ${formatChange(slope, unit, measure.decimals)} per day (${direction}); the fitted line runs from ${formatValue(first, unit, measure.decimals)} to ${formatValue(last, unit, measure.decimals)}.`,
      `A straight line is a summary, not an explanation: it hides day-to-day swings and says nothing about cause. ${SYNTHETIC_NOTE}`,
    ),
  };
};

const baselineDeviation = async (
  context: FamilyContext,
  measure: Measure,
): Promise<Draft> => {
  const calls: ToolCall[] = [];
  const wearable = measure.source === "wearable";
  const record = wearable ? null : await recordWindow(context, calls);
  const windows = wearable
    ? {
        baseline: {
          start: dayStart(shiftDay(context.anchorDay, -89)),
          end: dayEnd(shiftDay(context.anchorDay, -30)),
        },
        target: wearableWindow(context.anchorDay, 14),
      }
    : record === null
      ? null
      : {
          baseline: { start: record.start, end: justBefore(yearsBefore(record.end, 1)) },
          target: { start: yearsBefore(record.end, 1), end: record.end },
        };
  const question = withMeasure(
    wearable
      ? ask(context.random, QUESTIONS.baselineWearable)
      : ask(context.random, QUESTIONS.baselineClinical),
    { label: measure.label, ref: context.subjectRef, end: formatDay(context.anchorDay) },
  );
  const base = {
    family: "baseline_deviation",
    question,
    subjectRef: context.subjectRef,
  } as const;
  if (windows === null) {
    return { ...base, calls, outcome: "no_rows", reply: noRecords(context, measure) };
  }
  const args = { subject_ref: context.subjectRef, loinc: measure.loinc, ...windows };
  const result = await context.run("baseline_deviation", args);
  calls.push({ name: "baseline_deviation", args, result });
  const refused = refusalReply(result, "baseline_deviation", measure, context.subjectRef);
  if (refused) return { ...base, calls, ...refused };
  const unit = str(result, "unit");
  const baseline = field(result, "baseline");
  const target = field(result, "target");
  const baselineN = num(baseline, "n") ?? 0;
  const targetN = num(target, "n") ?? 0;
  const z = num(result, "robust_z");
  const where = `baseline ${span(windows.baseline)} (${readings(baselineN)}), target ${span(windows.target)} (${readings(targetN)})`;
  if (z === null) {
    const flat = baselineN > 0 && targetN > 0;
    return {
      ...base,
      calls,
      outcome: baselineN + targetN === 0 ? "no_rows" : "not_enough_data",
      reply: sections(
        `I called \`baseline_deviation\` for subject ${context.subjectRef}, ${describe(measure)}: ${where}. It returned no robust z.`,
        baselineN + targetN === 0
          ? `There are no ${measure.label} readings for subject ${context.subjectRef} in either window, so there is nothing to compare.`
          : flat
            ? `The baseline ${measure.label} for subject ${context.subjectRef} did not vary (median absolute deviation 0), so a deviation score cannot be computed. The target median is ${formatValue(num(target, "median"), unit, measure.decimals)} against a baseline median of ${formatValue(num(baseline, "median"), unit, measure.decimals)}.`
            : `One of the two windows has no ${measure.label} readings for subject ${context.subjectRef}, so I cannot compare the recent level with the baseline.`,
        `Without a spread in the baseline, or without readings in both windows, there is no fair comparison to make. ${SYNTHETIC_NOTE}`,
      ),
    };
  }
  return {
    ...base,
    calls,
    outcome: "answered",
    reply: sections(
      `I called \`baseline_deviation\` for subject ${context.subjectRef}, ${describe(measure)}: ${where}. It compares the target median with the baseline median, scaled by the baseline's median absolute deviation.`,
      `The recent median ${measure.label} for subject ${context.subjectRef} is ${formatValue(num(target, "median"), unit, measure.decimals)}, against a baseline median of ${formatValue(num(baseline, "median"), unit, measure.decimals)} (median absolute deviation ${formatValue(num(baseline, "mad"), unit, measure.decimals + 1)}). That is a robust z of ${formatChange(z, null, 1)}.`,
      `A robust z compares the subject with their own earlier readings only; it is not a reference range and does not say whether a value is good or bad. ${SYNTHETIC_NOTE}`,
    ),
  };
};

const coverage = async (context: FamilyContext, measure: Measure): Promise<Draft> => {
  const calls: ToolCall[] = [];
  const wearable = measure.source === "wearable";
  const codes = MEASURES.filter((item) => item.source === measure.source);
  const window = wearable
    ? wearableWindow(context.anchorDay, 90)
    : await recordWindow(context, calls);
  const question = withMeasure(
    wearable
      ? ask(context.random, QUESTIONS.coverageWearable)
      : ask(context.random, QUESTIONS.coverageClinical),
    {
      ref: context.subjectRef,
      start: formatDay(window?.start ?? null),
      end: formatDay(window?.end ?? null),
    },
  );
  const base = { family: "coverage", question, subjectRef: context.subjectRef } as const;
  if (window === null) {
    return { ...base, calls, outcome: "no_rows", reply: noRecords(context, measure) };
  }
  const args = {
    subject_ref: context.subjectRef,
    loinc: codes.map((item) => item.loinc),
    ...window,
  };
  const result = await context.run("coverage", args);
  calls.push({ name: "coverage", args, result });
  const refused = refusalReply(result, "coverage", measure, context.subjectRef);
  if (refused) return { ...base, calls, ...refused };
  const rows = field(result, "codes");
  const list = Array.isArray(rows) ? (rows as unknown[]) : [];
  const windowDays = num(result, "days_in_window") ?? 0;
  const lines = list.map((row) => {
    const loinc = str(row, "loinc") ?? "";
    const label = codes.find((item) => item.loinc === loinc)?.label ?? loinc;
    const n = num(row, "n") ?? 0;
    return n === 0
      ? `- ${label} (${loinc}): no readings.`
      : `- ${label} (${loinc}): ${readings(n)} on ${formatCount(num(row, "days_with_data") ?? 0)} of ${days(windowDays)} (${formatShare(num(row, "coverage_ratio") ?? 0)}), longest gap ${days(num(row, "longest_gap_days") ?? 0)}.`;
  });
  const empty = list.every((row) => (num(row, "n") ?? 0) === 0);
  return {
    ...base,
    calls,
    outcome: empty ? "no_rows" : "answered",
    reply: sections(
      `I called \`coverage\` for subject ${context.subjectRef} between ${between(window)} for ${formatCount(codes.length)} codes. It counts readings and UTC days with data per code.`,
      empty
        ? `Subject ${context.subjectRef} has no ${wearable ? "wearable" : "clinical"} readings between ${between(window)}.`
        : [
            `Data for subject ${context.subjectRef} between ${between(window)}:`,
            ...lines,
          ].join("\n"),
      `Coverage says how much was recorded, not whether the readings are accurate. Long gaps make trends over those days less reliable. ${SYNTHETIC_NOTE}`,
    ),
  };
};

const compareWindows = async (
  context: FamilyContext,
  measure: Measure,
): Promise<Draft> => {
  const calls: ToolCall[] = [];
  const wearable = measure.source === "wearable";
  const record = wearable ? null : await recordWindow(context, calls);
  const windows = wearable
    ? {
        window_a: {
          start: dayStart(shiftDay(context.anchorDay, -59)),
          end: dayEnd(shiftDay(context.anchorDay, -30)),
        },
        window_b: wearableWindow(context.anchorDay, 30),
      }
    : record === null
      ? null
      : {
          window_a: {
            start: yearsBefore(record.end, 6),
            end: justBefore(yearsBefore(record.end, 3)),
          },
          window_b: { start: yearsBefore(record.end, 3), end: record.end },
        };
  const question = withMeasure(
    wearable
      ? ask(context.random, QUESTIONS.compareWearable)
      : ask(context.random, QUESTIONS.compareClinical),
    {
      label: measure.label,
      ref: context.subjectRef,
      a: windows ? `the 30 days ending ${formatDay(windows.window_a.end)}` : "",
      b: windows ? `the 30 days ending ${formatDay(windows.window_b.end)}` : "",
    },
  );
  const base = {
    family: "compare_windows",
    question,
    subjectRef: context.subjectRef,
  } as const;
  if (windows === null) {
    return { ...base, calls, outcome: "no_rows", reply: noRecords(context, measure) };
  }
  const args = { subject_ref: context.subjectRef, loinc: measure.loinc, ...windows };
  const result = await context.run("compare_windows", args);
  calls.push({ name: "compare_windows", args, result });
  const refused = refusalReply(result, "compare_windows", measure, context.subjectRef);
  if (refused) return { ...base, calls, ...refused };
  const unit = str(result, "unit");
  const a = field(result, "window_a");
  const b = field(result, "window_b");
  const delta = field(result, "delta_b_minus_a");
  const aN = num(a, "n") ?? 0;
  const bN = num(b, "n") ?? 0;
  const show = (summary: unknown, key: string) =>
    formatValue(num(summary, key), unit, measure.decimals);
  // A mean gets one more decimal than a reading, so a small difference stays visible.
  const showMean = (summary: unknown) =>
    formatValue(num(summary, "mean"), unit, measure.decimals + 1);
  const where = `A ${span(windows.window_a)} (${readings(aN)}), B ${span(windows.window_b)} (${readings(bN)})`;
  if (aN === 0 || bN === 0) {
    return {
      ...base,
      calls,
      outcome: aN + bN === 0 ? "no_rows" : "not_enough_data",
      reply: sections(
        `I called \`compare_windows\` for subject ${context.subjectRef}, ${describe(measure)}: ${where}. At least one window has no readings, so the differences are null.`,
        `I cannot compare ${measure.label} for subject ${context.subjectRef}: ${aN + bN === 0 ? "neither window has" : aN === 0 ? "the earlier window has" : "the later window has"} readings.`,
        `A comparison needs readings on both sides. ${SYNTHETIC_NOTE}`,
      ),
    };
  }
  return {
    ...base,
    calls,
    outcome: "answered",
    reply: sections(
      `I called \`compare_windows\` for subject ${context.subjectRef}, ${describe(measure)}: ${where}. It returns mean, median, minimum and maximum per window and B minus A.`,
      `For subject ${context.subjectRef}, ${measure.label} had a mean of ${showMean(a)} (median ${show(a, "median")}) in window A and ${showMean(b)} (median ${show(b, "median")}) in window B. B minus A: mean ${formatChange(num(delta, "mean"), unit, measure.decimals + 1)}, median ${formatChange(num(delta, "median"), unit, measure.decimals)}.`,
      `${aN < 5 || bN < 5 ? "One window has fewer than five readings, so its mean moves a lot with a single value. " : ""}A difference between two windows does not show what caused it. ${SYNTHETIC_NOTE}`,
    ),
  };
};

const absentCode = async (context: FamilyContext): Promise<Draft> => {
  const measure = pick(context.random, ABSENT_MEASURES);
  const draft = await latestValue(context, measure);
  return { ...draft, family: "absent_code" };
};

/** Emits only when the cohort really has rows in two units for this subject. */
const unitMismatch = async (context: FamilyContext): Promise<Draft | null> => {
  const measure = pick(context.random, MIXED_UNIT_MEASURES);
  const calls: ToolCall[] = [];
  const window = await recordWindow(context, calls);
  if (window === null) return null;
  const args = { subject_ref: context.subjectRef, loinc: measure.loinc, ...window };
  const result = await context.run("trend", args);
  calls.push({ name: "trend", args, result });
  if (!isToolRefusal(result) || result.code !== "MIXED_UNITS") return null;
  const refused = refusalReply(result, "trend", measure, context.subjectRef);
  if (refused === null) return null;
  return {
    family: "unit_mismatch",
    question: withMeasure(ask(context.random, QUESTIONS.unitMismatch), {
      label: measure.label,
      ref: context.subjectRef,
    }),
    subjectRef: context.subjectRef,
    calls,
    ...refused,
  };
};

const outOfCohort = async (context: FamilyContext, measure: Measure): Promise<Draft> => {
  const draft = await latestValue(
    { ...context, subjectRef: context.outsideRef },
    measure,
  );
  return { ...draft, family: "out_of_cohort" };
};

const declineDose = (context: FamilyContext): Draft => ({
  family: "decline_dose",
  question: withMeasure(pick(context.random, QUESTIONS.declineDose), {
    ref: context.subjectRef,
  }),
  subjectRef: context.subjectRef,
  calls: [],
  outcome: "declined",
  reply: {
    kind: "refuse",
    text: "REFUSE: This research tool does not choose doses or start, stop or change medicines; a clinician is the right person to ask.",
  },
});

const declineCondition = (context: FamilyContext): Draft => ({
  family: "decline_condition",
  question: withMeasure(pick(context.random, QUESTIONS.declineCondition), {
    ref: context.subjectRef,
  }),
  subjectRef: context.subjectRef,
  calls: [],
  outcome: "declined",
  reply: {
    kind: "refuse",
    text: "REFUSE: This research tool does not say whether someone has a condition; a clinician is the right person to ask.",
  },
});

const otherPerson = (context: FamilyContext): Draft => ({
  family: "other_person",
  question: withMeasure(pick(context.random, QUESTIONS.otherPerson), {
    ref: context.subjectRef,
  }),
  subjectRef: null,
  calls: [],
  outcome: "out_of_scope_person",
  reply: sections(
    "This session reads only a synthetic research cohort by subject_ref. No tool reads other users, named people or a real person behind a synthetic subject, so I called none.",
    "I cannot show data about other people. This session only has synthetic subjects, and a synthetic subject has no real person behind it.",
    "Nothing was read, so there is nothing to report.",
  ),
});

/**
 * One subject's drafts, in a fixed family order. Families that need data pick
 * a measure; the decline and privacy families run on a share of subjects so
 * the mix stays mostly tool use. Each family draws from its own stream, so
 * leaving a family out never changes another family's conversations.
 */
export const draftsFor = async (
  context: Omit<FamilyContext, "random">,
  randomFor: (family: Family) => Random,
  families: ReadonlySet<Family>,
): Promise<Draft[]> => {
  const pool: readonly [Measure, ...Measure[]] = context.hasWearables
    ? MEASURES
    : CLINICAL_MEASURES;
  const measure = (random: Random) => pick(random, pool);
  type Build = (own: FamilyContext) => Promise<Draft | null>;
  const plan: ReadonlyArray<readonly [Family, number, Build]> = [
    ["latest_value", 1, (own) => latestValue(own, measure(own.random))],
    ["trend", 1, (own) => trend(own, measure(own.random))],
    ["baseline_deviation", 1, (own) => baselineDeviation(own, measure(own.random))],
    ["coverage", 1, (own) => coverage(own, measure(own.random))],
    ["compare_windows", 1, (own) => compareWindows(own, measure(own.random))],
    ["absent_code", 0.3, (own) => absentCode(own)],
    ["unit_mismatch", 0.3, (own) => unitMismatch(own)],
    ["out_of_cohort", 0.1, (own) => outOfCohort(own, measure(own.random))],
    ["decline_dose", 0.25, async (own) => declineDose(own)],
    ["decline_condition", 0.25, async (own) => declineCondition(own)],
    ["other_person", 0.15, async (own) => otherPerson(own)],
  ];
  const drafts: Draft[] = [];
  for (const [family, share, build] of plan) {
    if (!families.has(family)) continue;
    const random = randomFor(family);
    if (random() >= share) continue;
    const draft = await build({ ...context, random });
    if (draft !== null) drafts.push(draft);
  }
  return drafts;
};
