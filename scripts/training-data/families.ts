/**
 * The question families and the plan that runs them for one subject. The
 * families live in `data-families.ts`, `no-data-families.ts` and
 * `unit-families.ts`; the declines are here. Every number in an answer is a
 * number a tool returned (or, for a unit conversion, that number times a fixed
 * factor), formatted, never one a model produced.
 */
import { pick, type Random } from "../synthetic-wearables/random";

import {
  baselineDeviation,
  compareWindows,
  coverage,
  latestValue,
  trend,
} from "./data-families";
import {
  asked,
  type Draft,
  type Family,
  type FamilyContext,
  sections,
} from "./family-kit";
import { CLINICAL_MEASURES, type Measure, MEASURES, NEAR_MISSES } from "./measures";
import {
  absentCode,
  nearMiss,
  noCode,
  oddRef,
  outOfCohort,
  outsideRecord,
  wearableKey,
} from "./no-data-families";
import {
  genomeDeclineDose,
  genomeHostedProvider,
  genomeNoCall,
  genomeNotInReport,
  genomeOtherPerson,
  genomeVariant,
  genomeVariants,
} from "./genome-families";
import { anatomyNote } from "./anatomy-families";
import { ask } from "./questions";
import {
  hrvTrend,
  restingHrTrend,
  sleepNoRows,
  sleepSummary,
  trainingLoad,
  wearableNoRows,
  wearableTooShort,
} from "./wearable-families";
import { conversionsFor, unitConversion, unitMismatch } from "./unit-families";

export {
  type Draft,
  type Family,
  FAMILIES,
  GENOME_FAMILIES,
  TRACK_FAMILIES,
  type FamilyContext,
  type Outcome,
  type Sections,
  type ToolCall,
  type ToolName,
  TOOL_NAMES,
} from "./family-kit";

const declineDose = (context: FamilyContext): Draft => ({
  family: "decline_dose",
  ...asked(ask(context.random, "declineDose", { ref: context.subjectRef })),
  measureLoinc: null,
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
  ...asked(ask(context.random, "declineCondition", { ref: context.subjectRef })),
  measureLoinc: null,
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
  ...asked(ask(context.random, "otherPerson", { ref: context.subjectRef })),
  measureLoinc: null,
  subjectRef: null,
  calls: [],
  outcome: "out_of_scope_person",
  reply: sections(
    "This session reads only a synthetic research cohort by subject_ref. No tool reads other users, named people or a real person behind a synthetic subject, so I called none.",
    "I cannot show data about other people. This session only has synthetic subjects, and a synthetic subject has no real person behind it.",
    "Nothing was read, so there is nothing to report.",
  ),
});

export type Build = (own: FamilyContext) => Promise<Draft | null>;

/**
 * Share of subjects each family runs on. The five data families run for
 * everyone; the no-data and unit families together add about as many
 * conversations again, so a model sees "there is nothing to report" often.
 */
export const FAMILY_SHARES: Readonly<Record<Family, number>> = {
  latest_value: 1,
  trend: 1,
  baseline_deviation: 1,
  coverage: 1,
  compare_windows: 1,
  absent_code: 0.5,
  no_code: 0.4,
  wearable_key: 0.25,
  outside_record: 0.4,
  odd_ref: 0.3,
  near_miss: 0.5,
  unit_mismatch: 1,
  unit_conversion: 0.6,
  out_of_cohort: 0.1,
  decline_dose: 0.25,
  decline_condition: 0.25,
  other_person: 0.15,
  // Genome families (only with --genome). A family whose case the subject's
  // synthetic genome does not have (no no-call on the panel) is skipped.
  genome_variant: 0.5,
  genome_variants: 0.25,
  genome_no_call: 1,
  genome_not_in_report: 0.3,
  genome_decline_dose: 0.25,
  genome_other_person: 0.15,
  genome_hosted_provider: 0.15,
  // Track families (only with --track).
  agent_handover: 0.5,
  sleep_summary: 1,
  sleep_no_rows: 0.3,
  hrv_trend: 1,
  resting_hr_trend: 1,
  training_load: 1,
  wearable_too_short: 0.3,
  wearable_no_rows: 0.3,
  anatomy_note: 1,
};

/**
 * What a training track (`tracks.ts`) narrows: the measures its questions ask
 * about, and the hand-over family's builder. Without a scope every measure is
 * asked about and there is no hand-over, exactly as before tracks.
 */
export type TrackScope = Readonly<{
  /** The measures a track asks about, or null for every measure. */
  measures: readonly Measure[] | null;
  /** Builds the `agent_handover` draft, or null when there is none. */
  handover: Build | null;
}>;

const NO_SCOPE: TrackScope = { measures: null, handover: null };

const nonEmpty = <T>(items: readonly T[]): readonly [T, ...T[]] | null => {
  const [first, ...rest] = items;
  return first === undefined ? null : [first, ...rest];
};

/**
 * One subject's drafts, in a fixed family order. Families that need data pick
 * a measure; the others run on a share of subjects. Each family draws from its
 * own stream, so leaving a family out never changes another family's
 * conversations. A track scope narrows the measures; a family with no measure
 * left for this subject (a sleep question without a wearable series) is
 * skipped.
 */
export const draftsFor = async (
  context: Omit<FamilyContext, "random">,
  randomFor: (family: Family) => Random,
  families: ReadonlySet<Family>,
  scope: TrackScope = NO_SCOPE,
): Promise<Draft[]> => {
  const tracked = scope.measures;
  const inTrack = (loinc: string) =>
    tracked === null || tracked.some((measure) => measure.loinc === loinc);
  const pool: readonly [Measure, ...Measure[]] | null =
    tracked === null
      ? context.hasWearables
        ? MEASURES
        : CLINICAL_MEASURES
      : nonEmpty(
          tracked.filter(
            (measure) => context.hasWearables || measure.source === "clinical",
          ),
        );
  const misses =
    tracked === null
      ? NEAR_MISSES
      : nonEmpty(
          NEAR_MISSES.filter(
            (miss) =>
              inTrack(miss.asked.loinc) &&
              (context.hasWearables || miss.asked.source === "clinical"),
          ),
        );
  const conversions =
    tracked === null
      ? conversionsFor(context.hasWearables)
      : nonEmpty(
          conversionsFor(context.hasWearables).filter(
            (conversion) =>
              inTrack(conversion.measure.loinc) &&
              (context.hasWearables || conversion.measure.source === "clinical"),
          ),
        );
  /** A builder that needs a measure; skipped when the track leaves none. */
  const withPool =
    (
      build: (
        own: FamilyContext,
        from: readonly [Measure, ...Measure[]],
      ) => Promise<Draft>,
    ) =>
    (own: FamilyContext) => (pool === null ? Promise.resolve(null) : build(own, pool));
  const measure = (random: Random, from: readonly [Measure, ...Measure[]]) =>
    pick(random, from);
  const plan: ReadonlyArray<readonly [Family, Build]> = [
    [
      "latest_value",
      withPool((own, from) => latestValue(own, measure(own.random, from))),
    ],
    ["trend", withPool((own, from) => trend(own, measure(own.random, from)))],
    [
      "baseline_deviation",
      withPool((own, from) => baselineDeviation(own, measure(own.random, from))),
    ],
    ["coverage", withPool((own, from) => coverage(own, measure(own.random, from)))],
    [
      "compare_windows",
      withPool((own, from) => compareWindows(own, measure(own.random, from))),
    ],
    ["absent_code", (own) => absentCode(own)],
    ["no_code", async (own) => noCode(own)],
    ["wearable_key", async (own) => wearableKey(own)],
    ["outside_record", withPool((own, from) => outsideRecord(own, from))],
    ["odd_ref", withPool((own, from) => oddRef(own, from))],
    [
      "near_miss",
      (own) => (misses === null ? Promise.resolve(null) : nearMiss(own, misses)),
    ],
    ["unit_mismatch", (own) => unitMismatch(own)],
    [
      "unit_conversion",
      (own) =>
        conversions === null ? Promise.resolve(null) : unitConversion(own, conversions),
    ],
    [
      "out_of_cohort",
      withPool((own, from) => outOfCohort(own, measure(own.random, from))),
    ],
    ["decline_dose", async (own) => declineDose(own)],
    ["decline_condition", async (own) => declineCondition(own)],
    ["other_person", async (own) => otherPerson(own)],
    // After every other family, so turning them on never reorders a run.
    ["genome_variant", async (own) => genomeVariant(own)],
    ["genome_variants", async (own) => genomeVariants(own)],
    ["genome_no_call", async (own) => genomeNoCall(own)],
    ["genome_not_in_report", async (own) => genomeNotInReport(own)],
    ["genome_decline_dose", async (own) => genomeDeclineDose(own)],
    ["genome_other_person", async (own) => genomeOtherPerson(own)],
    ["genome_hosted_provider", async (own) => genomeHostedProvider(own)],
    // Tracks only, last of all.
    ["agent_handover", (own) => scope.handover?.(own) ?? Promise.resolve(null)],
    ["sleep_summary", (own) => sleepSummary(own)],
    ["sleep_no_rows", (own) => sleepNoRows(own)],
    ["hrv_trend", (own) => hrvTrend(own)],
    ["resting_hr_trend", (own) => restingHrTrend(own)],
    ["training_load", (own) => trainingLoad(own)],
    ["wearable_too_short", (own) => wearableTooShort(own)],
    ["wearable_no_rows", (own) => wearableNoRows(own)],
    ["anatomy_note", (own) => anatomyNote(own)],
  ];
  const drafts: Draft[] = [];
  for (const [family, build] of plan) {
    if (!families.has(family)) continue;
    const random = randomFor(family);
    if (random() >= FAMILY_SHARES[family]) continue;
    const draft = await build({ ...context, random });
    if (draft !== null) drafts.push(draft);
  }
  return drafts;
};
