/**
 * The families that answer with numbers: latest value, trend, baseline
 * deviation, coverage and two-window comparison. Each calls the real closed
 * query tools through `run` and writes the answer from what they returned:
 * every number in an answer is a number a tool returned, formatted. A refusal,
 * an empty result or a null field becomes an honest "cannot say" answer.
 */
import { pick } from "../synthetic-wearables/random";

import {
  asked,
  between,
  dayEnd,
  dayStart,
  describe,
  type Draft,
  type Family,
  type FamilyContext,
  field,
  fullRecord,
  justBefore,
  noRecords,
  num,
  recordWindow,
  refusalReply,
  sections,
  shiftDay,
  span,
  str,
  SYNTHETIC_NOTE,
  type ToolCall,
  type Window,
  yearsBefore,
} from "./family-kit";
import { formatChange, formatCount, formatDay, formatShare, formatValue } from "./format";
import { type Measure, MEASURES } from "./measures";
import { type Asked, ask, askDay, nameMeasure } from "./questions";

const days = (n: number): string => `${formatCount(n)} ${n === 1 ? "day" : "days"}`;
export const readings = (n: number): string =>
  `${formatCount(n)} ${n === 1 ? "reading" : "readings"}`;

/** Extra sentences for a latest-value answer (a near miss names the neighbour it did not use). */
export type LatestNotes = Readonly<{ reasoning?: string; answer?: string }>;

const withNote = (text: string, note: string | undefined): string =>
  note === undefined ? text : `${text} ${note}`;

/** A latest-value draft for an already asked question; families that differ only in the measure or ref reuse it. */
export const latestDraft = async (
  context: FamilyContext,
  measure: Measure,
  family: Family,
  question: Asked,
  notes: LatestNotes = {},
): Promise<Draft> => {
  const args = { subject_ref: context.subjectRef, loinc: [measure.loinc] };
  const result = await context.run("latest_by_loinc", args);
  const calls = [{ name: "latest_by_loinc", args, result }] as const;
  const base = {
    family,
    ...asked(question),
    measureLoinc: measure.loinc,
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
        withNote(
          `I called \`latest_by_loinc\` for subject ${context.subjectRef}, ${describe(measure)}. It returned no rows.`,
          notes.reasoning,
        ),
        withNote(
          `There is no ${measure.label} reading for subject ${context.subjectRef}, so I cannot give a latest value.`,
          notes.answer,
        ),
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
      withNote(
        `I called \`latest_by_loinc\` for subject ${context.subjectRef}, ${describe(measure)}. It returned one row: ${shown} on ${formatDay(at)}.`,
        notes.reasoning,
      ),
      withNote(
        `The latest ${measure.label} for subject ${context.subjectRef} is ${shown}, recorded on ${formatDay(at)}.`,
        notes.answer,
      ),
      `This is a single reading; one value says nothing about a pattern. ${SYNTHETIC_NOTE}`,
    ),
  };
};

export const latestValue = (context: FamilyContext, measure: Measure): Promise<Draft> =>
  latestDraft(
    context,
    measure,
    "latest_value",
    ask(context.random, "latest", {
      label: nameMeasure(context.random, measure),
      ref: context.subjectRef,
    }),
  );

const wearableWindow = (anchorDay: string, n: number): Window => ({
  start: dayStart(shiftDay(anchorDay, -(n - 1))),
  end: dayEnd(anchorDay),
});

const RECENT_DAYS = [30, 45, 60, 90] as const;
const RECENT_SHARE = 0.3;

/**
 * A wearable window, either with dates in the question or as "the last N
 * days of records". The second reads `subject_window` first, because only the
 * record says where "the last N days" end.
 */
type WearableAsk = Readonly<{
  window: Window | null;
  question: Asked;
  /** Reasoning that explains a relative window; empty for explicit dates. */
  lead: string;
}>;

const askWearableWindow = async (
  context: FamilyContext,
  calls: ToolCall[],
  n: number,
  explicit: "trendWearable" | "coverageWearable",
  recent: "trendRecent" | "coverageRecent",
  label: string,
): Promise<WearableAsk> => {
  if (context.random() < RECENT_SHARE) {
    const count = pick(context.random, RECENT_DAYS);
    const question = ask(context.random, recent, {
      label,
      ref: context.subjectRef,
      days: String(count),
    });
    const record = await fullRecord(context, calls);
    if (record === null) return { window: null, question, lead: "" };
    const endDay = record.end.slice(0, 10);
    const window = {
      start: dayStart(shiftDay(endDay, -(count - 1))),
      end: dayEnd(endDay),
    };
    return {
      window,
      question,
      lead: `I called \`subject_window\` for subject ${context.subjectRef}: the records end on ${formatDay(record.end)}, so the last ${days(count)} run from ${span(window)}. `,
    };
  }
  const window = wearableWindow(context.anchorDay, n);
  return {
    window,
    question: ask(context.random, explicit, {
      label,
      ref: context.subjectRef,
      start: askDay(context.random, window.start),
      end: askDay(context.random, window.end),
    }),
    lead: "",
  };
};

export const trend = async (
  context: FamilyContext,
  measure: Measure,
  family: Family = "trend",
): Promise<Draft> => {
  const calls: ToolCall[] = [];
  const label = nameMeasure(context.random, measure);
  const wearable = measure.source === "wearable";
  const chosen: WearableAsk = wearable
    ? await askWearableWindow(context, calls, 60, "trendWearable", "trendRecent", label)
    : {
        question: ask(context.random, "trendClinical", {
          label,
          ref: context.subjectRef,
        }),
        window: await recordWindow(context, calls),
        lead: "",
      };
  const { window, lead } = chosen;
  const base = {
    family,
    ...asked(chosen.question),
    measureLoinc: measure.loinc,
    subjectRef: context.subjectRef,
  } as const;
  if (window === null) {
    return {
      ...base,
      calls,
      outcome: "no_rows",
      reply: noRecords(context.subjectRef, describe(measure)),
    };
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
        `${lead}I called \`trend\` for subject ${context.subjectRef}, ${describe(measure)}, between ${between(window)}. It read ${readings(n)} and returned no slope (it needs at least 3 readings over 2 days or more).`,
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
      `${lead}I called \`trend\` for subject ${context.subjectRef}, ${describe(measure)}, between ${between(window)}. It fitted a least-squares line to ${readings(n)} from ${formatDay(str(result, "first_at"))} to ${formatDay(str(result, "last_at"))}.`,
      `Over ${readings(n)}, ${measure.label} for subject ${context.subjectRef} has a fitted slope of ${formatChange(slope, unit, measure.decimals)} per day (${direction}); the fitted line runs from ${formatValue(first, unit, measure.decimals)} to ${formatValue(last, unit, measure.decimals)}.`,
      `A straight line is a summary, not an explanation: it hides day-to-day swings and says nothing about cause. ${SYNTHETIC_NOTE}`,
    ),
  };
};

export const baselineDeviation = async (
  context: FamilyContext,
  measure: Measure,
  family: Family = "baseline_deviation",
): Promise<Draft> => {
  const calls: ToolCall[] = [];
  const label = nameMeasure(context.random, measure);
  const wearable = measure.source === "wearable";
  const question = wearable
    ? ask(context.random, "baselineWearable", {
        label,
        ref: context.subjectRef,
        end: askDay(context.random, context.anchorDay),
      })
    : ask(context.random, "baselineClinical", { label, ref: context.subjectRef });
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
  const base = {
    family,
    ...asked(question),
    measureLoinc: measure.loinc,
    subjectRef: context.subjectRef,
  } as const;
  if (windows === null) {
    return {
      ...base,
      calls,
      outcome: "no_rows",
      reply: noRecords(context.subjectRef, describe(measure)),
    };
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

export const coverage = async (
  context: FamilyContext,
  measure: Measure,
): Promise<Draft> => {
  const calls: ToolCall[] = [];
  const wearable = measure.source === "wearable";
  const codes = MEASURES.filter((item) => item.source === measure.source);
  const chosen: WearableAsk = wearable
    ? await askWearableWindow(
        context,
        calls,
        90,
        "coverageWearable",
        "coverageRecent",
        "",
      )
    : {
        question: ask(context.random, "coverageClinical", { ref: context.subjectRef }),
        window: await recordWindow(context, calls),
        lead: "",
      };
  const { window, lead } = chosen;
  const base = {
    family: "coverage",
    ...asked(chosen.question),
    measureLoinc: null,
    subjectRef: context.subjectRef,
  } as const;
  if (window === null) {
    return {
      ...base,
      calls,
      outcome: "no_rows",
      reply: noRecords(context.subjectRef, `${wearable ? "wearable" : "clinical"} data`),
    };
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
      `${lead}I called \`coverage\` for subject ${context.subjectRef} between ${between(window)} for ${formatCount(codes.length)} codes. It counts readings and UTC days with data per code.`,
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

export const compareWindows = async (
  context: FamilyContext,
  measure: Measure,
  family: Family = "compare_windows",
): Promise<Draft> => {
  const calls: ToolCall[] = [];
  const label = nameMeasure(context.random, measure);
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
  const question =
    wearable && windows !== null
      ? ask(context.random, "compareWearable", {
          label,
          ref: context.subjectRef,
          a: `the 30 days ending ${askDay(context.random, windows.window_a.end)}`,
          b: `the 30 days ending ${askDay(context.random, windows.window_b.end)}`,
        })
      : ask(context.random, "compareClinical", { label, ref: context.subjectRef });
  const base = {
    family,
    ...asked(question),
    measureLoinc: measure.loinc,
    subjectRef: context.subjectRef,
  } as const;
  if (windows === null) {
    return {
      ...base,
      calls,
      outcome: "no_rows",
      reply: noRecords(context.subjectRef, describe(measure)),
    };
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
