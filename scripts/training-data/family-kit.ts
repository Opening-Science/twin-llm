/**
 * What every question family shares: the draft a family returns, the context
 * it runs in, and small helpers to read tool results and write the four
 * sections. Pure.
 */
import { isToolRefusal } from "../../packages/query-tools/refusals";
import type { Random } from "../synthetic-wearables/random";

import { formatDay } from "./format";
import type { Measure } from "./measures";
import type { Asked, TemplateRef } from "./questions";

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
  "no_code",
  "wearable_key",
  "outside_record",
  "odd_ref",
  "near_miss",
  "unit_mismatch",
  "unit_conversion",
  "out_of_cohort",
  "decline_dose",
  "decline_condition",
  "other_person",
] as const;

export type Family = (typeof FAMILIES)[number];

/** What the answer had to do; tool refusal codes are copied as the tools spell them. */
export type Outcome =
  | "answered"
  | "converted"
  | "no_rows"
  | "not_enough_data"
  | "no_code"
  | "outside_record"
  | "no_subject_ref"
  | "SUBJECT_SCOPE_VIOLATION"
  | "MIXED_UNITS"
  | "ROW_CAP_EXCEEDED"
  | "declined"
  | "out_of_scope_person";

/** Outcomes where the honest answer is that there is nothing to report. */
export const NO_DATA_OUTCOMES: ReadonlySet<string> = new Set<Outcome>([
  "no_rows",
  "not_enough_data",
  "no_code",
  "outside_record",
  "no_subject_ref",
  "SUBJECT_SCOPE_VIOLATION",
]);

export type Sections = Readonly<{
  reasoning: string;
  answer: string;
  uncertainty: string;
}>;

export type Reply =
  | Readonly<{ kind: "sections"; sections: Sections }>
  | Readonly<{ kind: "refuse"; text: string }>;

export type Draft = Readonly<{
  family: Family;
  question: string;
  template: TemplateRef;
  /** The one code the question is about, or null (coverage, no code, declines). */
  measureLoinc: string | null;
  subjectRef: string | null;
  calls: readonly ToolCall[];
  reply: Reply;
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

/** The parts of a draft that come from asking: question and template. */
export const asked = (value: Asked) => ({
  question: value.question,
  template: value.template,
});

const DAY_MS = 86_400_000;

export const shiftDay = (day: string, days: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

export const dayStart = (day: string): string => `${day}T00:00:00.000Z`;
export const dayEnd = (day: string): string => `${day}T23:59:59.999Z`;

export const yearsBefore = (iso: string, years: number): string => {
  const date = new Date(iso);
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return date.toISOString();
};

/** One millisecond earlier: the tools' windows include both ends, so adjoining windows must not share one. */
export const justBefore = (iso: string): string =>
  new Date(Date.parse(iso) - 1).toISOString();

export type Window = Readonly<{ start: string; end: string }>;

export const between = (window: Window): string =>
  `${formatDay(window.start)} and ${formatDay(window.end)}`;

export const span = (window: Window): string =>
  `${formatDay(window.start)} to ${formatDay(window.end)}`;

export const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;

export const num = (value: unknown, key: string): number | null => {
  const found = field(value, key);
  return typeof found === "number" ? found : null;
};

export const str = (value: unknown, key: string): string | null => {
  const found = field(value, key);
  return typeof found === "string" ? found : null;
};

export const SYNTHETIC_NOTE =
  "The subject is synthetic (Synthea) and the numbers describe no real person.";

export const sections = (reasoning: string, answer: string, uncertainty: string) =>
  ({ kind: "sections", sections: { reasoning, answer, uncertainty } }) as const;

export const describe = (measure: Measure): string =>
  `${measure.label} (LOINC ${measure.loinc})`;

/** The answer for a tool refusal, or null when the result is not one. */
export const refusalReply = (
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

/** The subject's whole record window as `subject_window` returns it, or null when there are no rows. */
export const fullRecord = async (
  context: FamilyContext,
  calls: ToolCall[],
): Promise<Window | null> => {
  const args = { subject_ref: context.subjectRef };
  const result = await context.run("subject_window", args);
  calls.push({ name: "subject_window", args, result });
  const start = str(result, "start");
  const end = str(result, "end");
  return start === null || end === null ? null : { start, end };
};

/** The last five years of the subject's records, through the audited `subject_window` tool. */
export const recordWindow = async (
  context: FamilyContext,
  calls: ToolCall[],
): Promise<Window | null> => {
  const record = await fullRecord(context, calls);
  return record === null ? null : { start: yearsBefore(record.end, 5), end: record.end };
};

export const noRecords = (subjectRef: string, label: string) =>
  sections(
    `I called \`subject_window\` for subject ${subjectRef}; it returned no observations, so there is no window to read ${label} in.`,
    `There are no records for subject ${subjectRef}, so I cannot say anything about ${label}.`,
    `No data was read. ${SYNTHETIC_NOTE}`,
  );
