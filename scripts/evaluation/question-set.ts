/**
 * The shape of the C2 evaluation question set (`evaluation/questions.v1.json`)
 * and its answer key (`evaluation/answer-key.v1.json`).
 *
 * Expected host fields follow docs/response-schema.md v1.1 and the scenarios in
 * docs/evaluation/scenarios.md, so C3 can compare a response document field by
 * field. Numbers the answer must contain are never written by hand: an item
 * names the closed tool call that produces them, and the answer key generator
 * runs that call against the fixed-seed cohort. Pure module, no I/O.
 */
import { z } from "zod";

import {
  baselineDeviationInput,
  compareWindowsInput,
  coverageInput,
  latestByLoincInput,
  summaryStatsInput,
  trendInput,
  rangePositionInput,
  convertUnitInput,
  cohortPositionInput,
  conditionsTimelineInput,
  medicationsTimelineInput,
  valuesAroundEventInput,
} from "../../packages/query-tools/schemas";

import { isMeasureId } from "./score/asked-measure";

export const COHORT_ID = "synthea-v4-seed42";

/** The eight Annex 1 criteria, spelled as in docs/evaluation/scenarios.md. */
export const CRITERIA = [
  "correctness",
  "hallucination",
  "privacy",
  "query safety",
  "clinical caution",
  "readability",
  "consistency",
  "latency",
] as const;

export type Criterion = (typeof CRITERIA)[number];

/** S7 is UX-only and scored by a person, so it has no items here (C1). */
export const SCENARIOS = ["S1", "S2", "S3", "S4", "S5", "S6"] as const;

export type Scenario = (typeof SCENARIOS)[number];

/** Tools the answer key generator may run; each is a closed B1/B3 query tool. */
export const KEYED_TOOLS = {
  trend: trendInput,
  baseline_deviation: baselineDeviationInput,
  coverage: coverageInput,
  compare_windows: compareWindowsInput,
  latest_by_loinc: latestByLoincInput,
  summary_stats: summaryStatsInput,
  range_position: rangePositionInput,
  convert_unit: convertUnitInput,
  cohort_position: cohortPositionInput,
  conditions_timeline: conditionsTimelineInput,
  medications_timeline: medicationsTimelineInput,
  values_around_event: valuesAroundEventInput,
} as const;

export type KeyedTool = keyof typeof KEYED_TOOLS;

const KEYED_TOOL_NAMES = Object.keys(KEYED_TOOLS) as [KeyedTool, ...KeyedTool[]];

/** Tool names as the audit chain writes them (`audit_events.tool`). */
export const AUDIT_TOOL_NAMES = [
  "list_subjects",
  "subject_window",
  "observations_for_subject",
  "latest_by_loinc",
  "summary_stats",
  "trend",
  "baseline_deviation",
  "coverage",
  "compare_windows",
  "range_position",
  "convert_unit",
  "cohort_position",
  "conditions_timeline",
  "medications_timeline",
  "values_around_event",
  "guidelines.guideline_search",
  "knowledge.knowledge_search",
  "gbd.gbd_query",
] as const;

/** Every warehouse read, for items that must not touch subject data. `convert_unit` reads none. */
export const WAREHOUSE_TOOLS = AUDIT_TOOL_NAMES.filter(
  (name) => !name.includes(".") && name !== "convert_unit",
);

const auditToolName = z.enum(AUDIT_TOOL_NAMES);

/** Repeat count for consistency items; C3 may raise it. */
export const CONSISTENCY_REPEAT = 3;

/** Tag on the short items whose latency is reported as its own set. */
export const LATENCY_SET_TAG = "latency-set";

const tolerance = z.union([
  z.object({ abs: z.number().nonnegative() }).strict(),
  z.object({ rel: z.number().nonnegative() }).strict(),
  z.object({ exact: z.literal(true) }).strict(),
]);

/**
 * One number (or refusal code) the answer must report. `path` is a dotted path
 * into the tool result (`slope_per_day`, `baseline.median`, `codes.0.n`,
 * `rows.0.value`); `code` reads the refusal code. `unit` is the UCUM unit the
 * tool must return, null for a count, a ratio or a refusal.
 */
export const valueSpecSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9_]+$/),
    tool: z.enum(KEYED_TOOL_NAMES),
    args: z.record(z.string(), z.unknown()),
    path: z.string().min(1),
    unit: z.string().nullable(),
    tolerance,
  })
  .strict()
  .superRefine((spec, ctx) => {
    const parsed = KEYED_TOOLS[spec.tool].safeParse(spec.args);
    if (!parsed.success) {
      ctx.addIssue({ code: "custom", message: `args do not fit ${spec.tool}` });
    }
  });

export type ValueSpec = z.infer<typeof valueSpecSchema>;

const anyOr = <T extends z.ZodType>(schema: T) => z.union([schema, z.literal("any")]);

export const expectSchema = z
  .object({
    answer_class: z.enum(["analytics", "information", "declined_decision_support"]),
    /** `any` where C1 says it is "computed as usual" (S5: a tool call first is allowed). */
    sufficient_data: anyOr(z.boolean()),
    abstained: anyOr(z.boolean()),
    uncertainty: z
      .object({
        /** `any` for out-of-range probes where the model may offer a listed value instead. */
        level: anyOr(z.enum(["low", "moderate", "high"])),
        /** Must all appear; other reasons may too. */
        reasons: z.array(
          z.enum([
            "no_personal_data",
            "guideline_only",
            "population_only",
            "knowledge_only",
            "hallucinated_keys",
            "tool_returned_no_rows",
            "no_model_statement",
            "declined",
          ]),
        ),
      })
      .strict(),
    next_step: z.enum(["none", "more_data", "consult_clinician"]),
    interpretation_kind: z.enum(["narration", "none"]),
    tools: z
      .object({
        must_call: z.array(auditToolName),
        must_not_call: z.array(auditToolName),
      })
      .strict(),
    values: z.array(valueSpecSchema).optional(),
    /**
     * The measures the question asks about: LOINC codes, or measure names the
     * hallucination scorer knows (`MEASURE_NAMES`). When present the scorer
     * uses these instead of inferring the measure from the question.
     */
    measures: z
      .array(
        z.string().refine(isMeasureId, { message: "not a LOINC code or a measure name" }),
      )
      .min(1)
      .optional(),
    /** Phrases or behaviours that fail the item when present. */
    must_not: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const questionSchema = z
  .object({
    id: z.string().regex(/^Q-S[1-6]-\d{2}$/),
    scenario: z.enum(SCENARIOS),
    criteria: z.array(z.enum(CRITERIA)).min(1),
    question: z.string().min(10),
    subject_ref: z.string().min(1).optional(),
    context: z
      .object({
        data_mode: z.literal("synthetic"),
        corpora: z.array(z.enum(["warehouse", "guidelines", "gbd", "knowledge"])),
        /** Env the item needs; C3 skips (not fails) the item without it. */
        requires: z.array(z.enum(["GBD_MCP_URL", "GBD_MCP_TOKEN"])).optional(),
      })
      .strict(),
    expect: expectSchema,
    repeat: z.number().int().min(1),
    tags: z.array(z.string().min(1)).optional(),
    /** Notes for the human sheet: readability and tone the harness cannot score. */
    human: z.string().min(1),
  })
  .strict()
  .superRefine((item, ctx) => {
    if (!item.id.startsWith(`Q-${item.scenario}-`)) {
      ctx.addIssue({ code: "custom", message: "id does not match scenario" });
    }
    if (new Set(item.criteria).size !== item.criteria.length) {
      ctx.addIssue({ code: "custom", message: "criteria repeat" });
    }
    if (item.criteria.includes("consistency") !== item.repeat > 1) {
      ctx.addIssue({
        code: "custom",
        message: "consistency items repeat, others do not",
      });
    }
    const names = (item.expect.values ?? []).map((value) => value.name);
    if (new Set(names).size !== names.length) {
      ctx.addIssue({ code: "custom", message: "value names repeat" });
    }
  });

export type Question = z.infer<typeof questionSchema>;

export const questionSetSchema = z
  .object({
    schema_version: z.literal("twin-llm.eval.questions.v1"),
    cohort_id: z.literal(COHORT_ID),
    items: z.array(questionSchema),
  })
  .strict();

export type QuestionSet = z.infer<typeof questionSetSchema>;

const windowSchema = z.object({ start: z.string(), end: z.string() }).strict();

export const keyEntrySchema = z
  .object({
    name: z.string(),
    tool: z.enum(KEYED_TOOL_NAMES),
    args: z.record(z.string(), z.unknown()),
    path: z.string(),
    /** The number at `path`, the refusal code for `path: code`, or null when the tool returned none. */
    value: z.union([z.number(), z.string(), z.null()]),
    unit: z.string().nullable(),
    /** Observations the call read, as its audit row counts them. */
    n: z.number().int().nonnegative(),
    windows: z.array(windowSchema),
    refusal: z.string().nullable(),
  })
  .strict();

export type KeyEntry = z.infer<typeof keyEntrySchema>;

export const answerKeySchema = z
  .object({
    schema_version: z.literal("twin-llm.eval.answer-key.v1"),
    generator_version: z.string(),
    cohort: z
      .object({
        id: z.literal(COHORT_ID),
        synthea_version: z.string(),
        seed: z.number().int(),
        population: z.number().int(),
        age: z.string(),
        /** Synthea `-r` and `-e`, YYYYMMDD. */
        reference_date: z.string().regex(/^\d{8}$/),
        end_date: z.string().regex(/^\d{8}$/),
        subjects: z.number().int().nonnegative(),
        /** Checksum of the patient files the key was built from (manifest `contentSha256`). */
        content_sha256: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .strict(),
    open_twin_sha: z.string().regex(/^[0-9a-f]{40}$/),
    questions_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    actor: z.string(),
    generated_on: z.iso.date(),
    entries: z.record(z.string(), z.array(keyEntrySchema)),
  })
  .strict();

export type AnswerKey = z.infer<typeof answerKeySchema>;

export type CoverageCounts = Readonly<{
  total: number;
  byCriterion: Readonly<Record<Criterion, number>>;
  byScenario: Readonly<Record<Scenario, number>>;
  /** criterion → scenario → items. */
  matrix: Readonly<Record<Criterion, Readonly<Record<Scenario, number>>>>;
}>;

export const coverageCounts = (items: readonly Question[]): CoverageCounts => {
  const count = (criterion: Criterion, scenario?: Scenario): number =>
    items.filter(
      (item) =>
        item.criteria.includes(criterion) &&
        (scenario === undefined || item.scenario === scenario),
    ).length;
  return {
    total: items.length,
    byCriterion: Object.fromEntries(
      CRITERIA.map((criterion) => [criterion, count(criterion)]),
    ) as Record<Criterion, number>,
    byScenario: Object.fromEntries(
      SCENARIOS.map((scenario) => [
        scenario,
        items.filter((item) => item.scenario === scenario).length,
      ]),
    ) as Record<Scenario, number>,
    matrix: Object.fromEntries(
      CRITERIA.map((criterion) => [
        criterion,
        Object.fromEntries(
          SCENARIOS.map((scenario) => [scenario, count(criterion, scenario)]),
        ),
      ]),
    ) as Record<Criterion, Record<Scenario, number>>,
  };
};

/** Reads a dotted path (`baseline.median`, `codes.0.n`) from a tool result. */
export const readPath = (value: unknown, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (current, segment) =>
        typeof current === "object" && current !== null
          ? Reflect.get(current, segment)
          : undefined,
      value,
    );
