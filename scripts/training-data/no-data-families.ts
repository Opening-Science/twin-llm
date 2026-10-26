/**
 * Families whose honest answer is usually "there is nothing to report":
 * a LOINC the cohort does not have, a measure no tool can read, a wearable
 * key the prompt does not offer, a period outside the record, an odd or
 * missing subject_ref, a subject outside the cohort, and a measure that sounds
 * like another one. The answer never reads a different code in place of the
 * one asked for. Pure apart from `run`.
 */
import { pick } from "../synthetic-wearables/random";

import { latestDraft } from "./data-families";
import {
  asked,
  type Draft,
  type FamilyContext,
  fullRecord,
  noRecords,
  sections,
  SYNTHETIC_NOTE,
  type ToolCall,
} from "./family-kit";
import { formatDay } from "./format";
import {
  ABSENT_MEASURES,
  type Measure,
  NEAR_MISSES,
  NO_CODE_MEASURES,
  WEARABLE_KEYS,
  WEARABLE_MEASURES,
} from "./measures";
import { ask, askPeriod, nameMeasure } from "./questions";

const capitalise = (text: string): string =>
  `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

const NOT_SUBSTITUTED = "I did not read another measure in its place.";

export const absentCode = (context: FamilyContext): Promise<Draft> => {
  const measure = pick(context.random, ABSENT_MEASURES);
  return latestDraft(
    context,
    measure,
    "absent_code",
    ask(context.random, "latest", {
      label: nameMeasure(context.random, measure),
      ref: context.subjectRef,
    }),
    { answer: NOT_SUBSTITUTED },
  );
};

const SERIES_LABELS = WEARABLE_MEASURES.map((measure) => measure.label).join(", ");

/** A measure no tool can read: no tool call, and no other measure in its place. */
export const noCode = (context: FamilyContext): Draft => {
  const measure = pick(context.random, NO_CODE_MEASURES);
  const question = ask(context.random, "noCode", {
    label: measure.label,
    ref: context.subjectRef,
  });
  const why =
    measure.why === "local_code"
      ? `${capitalise(measure.label)} is stored in the synthetic wearable series under a local code, not a LOINC code, and the query tools read LOINC codes only. No tool can return it, so I called none.`
      : `Neither the synthetic cohort's clinic records nor its wearable series (${SERIES_LABELS}) include ${measure.label}, so there is no code to query and I called no tool.`;
  const notThis =
    measure.notThis === null
      ? ""
      : ` ${capitalise(measure.notThis)} is a different measure, so I did not query it instead.`;
  return {
    family: "no_code",
    ...asked(question),
    measureLoinc: null,
    subjectRef: context.subjectRef,
    calls: [],
    outcome: "no_code",
    reply: sections(
      `${why}${notThis}`,
      `There is no ${measure.label} data for subject ${context.subjectRef} that I can read, so I cannot report a value. I will not give a number from another measure instead.`,
      `Nothing was read, so nothing is known about ${measure.label} for this subject. ${SYNTHETIC_NOTE}`,
    ),
  };
};

/** A vendor key that is not in the prompt's Available keys: no tool call, no substitute. */
export const wearableKey = (context: FamilyContext): Draft => {
  const key = pick(context.random, WEARABLE_KEYS);
  const question = ask(context.random, "wearableKey", { key, ref: context.subjectRef });
  return {
    family: "wearable_key",
    ...asked(question),
    measureLoinc: null,
    subjectRef: context.subjectRef,
    calls: [],
    outcome: "no_code",
    reply: sections(
      `\`${key}\` is a wearable metric key. No wearable is linked in this session, so there are no available keys and \`${key}\` is not one of them. The query tools read LOINC codes for synthetic subjects, not vendor keys, and the synthetic series has no code for this metric, so I called no tool.`,
      `I cannot cite \`${key}\` for subject ${context.subjectRef}: it is not an available key in this session, and I will not report a different measure in its place.`,
      "Nothing was read. Evidence Used stays empty because no wearable key is available.",
    ),
  };
};

/** A period wholly before or after the subject's records: read the record window, then say so. */
export const outsideRecord = async (
  context: FamilyContext,
  pool: readonly [Measure, ...Measure[]],
): Promise<Draft> => {
  const measure = pick(context.random, pool);
  const label = nameMeasure(context.random, measure);
  const calls: ToolCall[] = [];
  const record = await fullRecord(context, calls);
  const firstYear = record === null ? 2000 : Number(record.start.slice(0, 4));
  const lastYear = record === null ? 2026 : Number(record.end.slice(0, 4));
  const earlier = firstYear - 1 - Math.floor(context.random() * 25);
  const before = context.random() < 0.6 && earlier >= 1900;
  const year = before ? earlier : lastYear + 1 + Math.floor(context.random() * 8);
  const period = askPeriod(context.random, year);
  const question = ask(context.random, "outsideRecord", {
    label,
    ref: context.subjectRef,
    period: period.text,
  });
  const base = {
    family: "outside_record",
    ...asked(question),
    measureLoinc: measure.loinc,
    subjectRef: context.subjectRef,
    calls,
  } as const;
  if (record === null) {
    return {
      ...base,
      outcome: "no_rows",
      reply: noRecords(context.subjectRef, measure.label),
    };
  }
  const side = before ? "before the first record" : "after the last record";
  return {
    ...base,
    outcome: "outside_record",
    reply: sections(
      `I called \`subject_window\` for subject ${context.subjectRef}: the records run from ${formatDay(record.start)} to ${formatDay(record.end)}. ${capitalise(period.text)} is ${side}, so no ${measure.label} (LOINC ${measure.loinc}) reading can fall in it, and I did not query the readings from other years.`,
      `There are no ${measure.label} readings for subject ${context.subjectRef} in ${period.text}: the records only run from ${formatDay(record.start)} to ${formatDay(record.end)}. I will not report the nearest reading in its place.`,
      `A reading from another period says nothing about ${period.text}. ${SYNTHETIC_NOTE}`,
    ),
  };
};

/** Refs a person might type that are not subject_refs (or not exactly); never the ref itself. */
const oddRefs = (subjectRef: string): readonly [string, ...string[]] => [
  "patient 12",
  ...[
    subjectRef.slice(0, 8),
    subjectRef.toUpperCase(),
    subjectRef.replaceAll("-", ""),
    "subject-0042",
    "P-1047",
    "#17",
    "S123",
    "test-subject",
  ].filter((ref) => ref !== subjectRef),
];

const NO_REF_WHO = [
  "my patient",
  "the subject we discussed",
  "the last subject",
  "this person",
  "the patient from yesterday",
] as const;

/**
 * An odd subject_ref is passed to the tool as written and the tool's refusal
 * is reported; a question with no ref at all gets no tool call.
 */
export const oddRef = async (
  context: FamilyContext,
  pool: readonly [Measure, ...Measure[]],
): Promise<Draft> => {
  const measure = pick(context.random, pool);
  const label = nameMeasure(context.random, measure);
  if (context.random() < 0.65) {
    const ref = pick(context.random, oddRefs(context.subjectRef));
    return latestDraft(
      { ...context, subjectRef: ref },
      measure,
      "odd_ref",
      ask(context.random, "latest", { label, ref }),
    );
  }
  const who = pick(context.random, NO_REF_WHO);
  const question = ask(context.random, "noRef", { label, who });
  return {
    family: "odd_ref",
    ...asked(question),
    measureLoinc: measure.loinc,
    subjectRef: null,
    calls: [],
    outcome: "no_subject_ref",
    reply: sections(
      `The question names no subject_ref ("${who}"). The tools read synthetic subjects by subject_ref only, and I will not guess which subject is meant, so I called no tool.`,
      `I need a subject_ref to look up ${measure.label}. \`list_subjects\` gives the subject_refs of a cohort; with one I can read the latest value.`,
      "Nothing was read. This session holds only synthetic subjects, and none of them is a real patient.",
    ),
  };
};

/** A measure that sounds like another: read the asked code only and say the neighbour differs. */
export const nearMiss = (context: FamilyContext): Promise<Draft> => {
  const { asked: measure, neighbour } = pick(context.random, NEAR_MISSES);
  return latestDraft(
    context,
    measure,
    "near_miss",
    ask(context.random, "latest", {
      label: nameMeasure(context.random, measure),
      ref: context.subjectRef,
    }),
    {
      reasoning: `I used the code for ${measure.label} only; ${neighbour.label} (LOINC ${neighbour.loinc}) is a different measure.`,
      answer: `${capitalise(neighbour.label)} is a different measure and is not reported in its place.`,
    },
  );
};

export const outOfCohort = (context: FamilyContext, measure: Measure): Promise<Draft> =>
  latestDraft(
    { ...context, subjectRef: context.outsideRef },
    measure,
    "out_of_cohort",
    ask(context.random, "latest", {
      label: nameMeasure(context.random, measure),
      ref: context.outsideRef,
    }),
  );
