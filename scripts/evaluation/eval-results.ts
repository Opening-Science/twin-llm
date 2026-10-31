/**
 * The files one eval run writes under `evaluation/runs/<run-id>/` (gitignored):
 * `results.jsonl`, one line per item × repeat × model, and `meta.json`.
 *
 * A line keeps what C3b scores from: the host's response document v1.1, the
 * model's text, the audit rows of the turn with any refusal code and subject,
 * the tool results (synthetic data; they stay in these gitignored files and
 * never reach report.md or review.csv), and timings.
 *
 * v2 (C3b) added `tool_results` and `audit[].subject_ref`. A v1 run is
 * upgraded by replaying it (`bun run eval -- … --replay`), which calls no model.
 * `error` is a fixed marker, never provider text, which can echo prompts or
 * row values. Pure module, no I/O.
 */
import { z } from "zod";

import { responseDocumentV1Schema } from "../../infrastructure/response-document/document-v1";

import { RECORDED_ARMS } from "./context-arm";

export const RESULTS_SCHEMA_VERSION = "twin-llm.eval.results.v2";
export const META_SCHEMA_VERSION = "twin-llm.eval.meta.v1";

export const QUESTIONS_PATH = "evaluation/questions.v1.json";
export const ANSWER_KEY_PATH = "evaluation/answer-key.v1.json";

/**
 * The question sets a run can take (`bun run eval -- --set s7`), each with its
 * own key and questions sha256. `v1` is the C2 set; `s7` the rhythm and
 * heart-brain items (#251), kept apart so the v1 hash never changes; `s7b`
 * the S7 items on the supplementary cohort synthea-v4-s7 (#277), kept apart
 * so the S7 hash never changes either; `s7h` the held-out S7 items drawn by a
 * seeded rule fixed before any output was seen (#283), scored apart from the
 * S7 and S7b development sets.
 */
export const QUESTION_SETS = {
  v1: { questions: QUESTIONS_PATH, key: ANSWER_KEY_PATH },
  s7: {
    questions: "evaluation/questions.s7.v1.json",
    key: "evaluation/answer-key.s7.v1.json",
  },
  s7b: {
    questions: "evaluation/questions.s7b.v1.json",
    key: "evaluation/answer-key.s7b.v1.json",
  },
  s7h: {
    questions: "evaluation/questions.s7h.v1.json",
    key: "evaluation/answer-key.s7h.v1.json",
  },
} as const;

export type QuestionSetId = keyof typeof QUESTION_SETS;

export const QUESTION_SET_IDS = Object.keys(QUESTION_SETS) as [
  QuestionSetId,
  ...QuestionSetId[],
];

export const isQuestionSetId = (value: string): value is QuestionSetId =>
  (QUESTION_SET_IDS as readonly string[]).includes(value);

export const RESULT_ERRORS = [
  "CACHE_MISS",
  "CACHE_CORRUPT",
  "TIMEOUT",
  "MODEL_FAILED",
  "PROVIDER_NOT_PERMITTED",
  "DOCUMENT_FAILED",
  "AUDIT_FAILED",
  /** Context arm (#302): a server-side read for the data block failed. */
  "CONTEXT_FAILED",
] as const;

export type ResultError = (typeof RESULT_ERRORS)[number];

/** An item that needs env this run lacks (S4 needs the GBD server): skipped, never scored. */
export const MISSING_ENV = "MISSING_ENV";

export const auditLineSchema = z
  .object({
    tool: z.string(),
    args_sha256: z.string(),
    row_count: z.number().int().nonnegative(),
    /** `SUBJECT_SCOPE_VIOLATION`, `MIXED_UNITS`, `ROW_CAP_EXCEEDED`, or null. */
    refusal: z.string().nullable(),
    /** The subject the call asked for, from its input; null for cohort and reference tools. */
    subject_ref: z.string().nullable(),
  })
  .strict();

export type AuditLine = z.infer<typeof auditLineSchema>;

export const toolResultLineSchema = z
  .object({
    tool: z.string(),
    input: z.unknown(),
    output: z.unknown(),
  })
  .strict();

export type ToolResultLine = z.infer<typeof toolResultLineSchema>;

const nullableCount = z.number().int().nonnegative().nullable();

export const resultLineSchema = z
  .object({
    schema_version: z.literal(RESULTS_SCHEMA_VERSION),
    item_id: z.string(),
    scenario: z.string(),
    /** 1-based. */
    repeat: z.number().int().min(1),
    provider: z.string(),
    model_id: z.string(),
    /** No real model answered: a fake in tests, or a replay of a fake's recording. */
    mock: z.boolean(),
    /** Every model call of the turn came from the cache. */
    cache_hit: z.boolean(),
    model_calls: z.number().int().nonnegative(),
    skipped: z.literal(MISSING_ENV).nullable(),
    error: z.enum(RESULT_ERRORS).nullable(),
    ttft_ms: z.number().int().nonnegative().nullable(),
    total_ms: z.number().int().nonnegative().nullable(),
    tokens: z
      .object({ input: nullableCount, output: nullableCount, total: nullableCount })
      .strict(),
    /** The model's whole reply, headings included. */
    text: z.string().nullable(),
    /** The `## Answer` section as the host parsed it. */
    answer_text: z.string().nullable(),
    document: responseDocumentV1Schema.nullable(),
    audit: z.array(auditLineSchema),
    /**
     * Every tool result of the turn, in step order; empty when the turn failed.
     * In the context arm (#302): the key's calls the server ran, as pasted.
     */
    tool_results: z.array(toolResultLineSchema),
    /**
     * Set only for a data-in-prompt arm; a line without it ran the tools arm.
     * `context` is the oracle arm as #302 named it, `context-oracle` the same
     * arm since #320, `context-fair` the fair arm (#320).
     */
    arm: z.enum(["context", "context-oracle", "context-fair"]).optional(),
    /** The data block of a context-arm line: its size and whether rows were cut. */
    context: z
      .object({
        calls: z.number().int().nonnegative(),
        rows_total: z.number().int().nonnegative(),
        rows_pasted: z.number().int().nonnegative(),
        truncated: z.boolean(),
        tokens: z.number().int().nonnegative(),
        cap_tokens: z.number().int().positive(),
      })
      .strict()
      .optional(),
    /** The fair arm's choice for this item (#320): the subject, and what the cap cut. */
    fair: z
      .object({
        subject_ref: z.string().nullable(),
        codes_total: z.number().int().nonnegative(),
        codes_pasted: z.number().int().nonnegative(),
        codes_cut: z.array(z.string()),
        conditions: z
          .object({ n: z.number().int().nonnegative(), pasted: z.boolean() })
          .strict(),
        medications: z
          .object({ n: z.number().int().nonnegative(), pasted: z.boolean() })
          .strict(),
        refusal: z.string().nullable(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ResultLine = z.infer<typeof resultLineSchema>;

/** Fields that legitimately differ between a recording and its replay. */
export const TIMING_FIELDS = ["ttft_ms", "total_ms"] as const;

export const metaSchema = z
  .object({
    schema_version: z.literal(META_SCHEMA_VERSION),
    run_id: z.string(),
    /** Loud on purpose: a MOCK run is a test of the harness, never a result. */
    mock: z.boolean(),
    replay: z.boolean(),
    date: z.iso.date(),
    git_sha: z.string(),
    /** Which question set ran; runs written before #251 have none and ran `v1`. */
    question_set: z.enum(QUESTION_SET_IDS).optional(),
    questions_sha256: z.string(),
    answer_key_sha256: z.string(),
    cohort_id: z.string(),
    open_twin_sha: z.string(),
    provider: z.string(),
    models: z.array(
      z
        .object({
          provider: z.string(),
          model_id: z.string(),
          /** The model endpoint's host:port; null on a replay, which reaches none. */
          host: z.string().nullable(),
          /**
           * Set when `model_id` is an agent (`agent:<id>`, #279): the model that
           * answered, the skill it ran under and the versions of both.
           */
          agent: z
            .object({
              id: z.string(),
              name: z.string(),
              base_model_id: z.string(),
              skill: z.string().nullable(),
              rules_sha256: z.string().regex(/^[0-9a-f]{64}$/),
              roster_sha256: z.string().regex(/^[0-9a-f]{64}$/),
            })
            .strict()
            .optional(),
        })
        .strict(),
    ),
    /**
     * How the model got the data: `tools` (the chat route), `context-oracle`
     * (#302: the key's results pasted, no tools; `context` in runs before
     * #320) or `context-fair` (#320: the named subject's record pasted, chosen
     * without the key). Runs before #302 have none and ran `tools`.
     */
    arm: z.enum(RECORDED_ARMS).optional(),
    /** Context arms: the token cap of each item's data block and how many items it cut. */
    context: z
      .object({
        cap_tokens: z.number().int().positive(),
        items_truncated: z.number().int().nonnegative(),
        lines_over_cap: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    /** The chat route sets none, so neither does the harness. */
    sampling: z.literal("none set"),
    /** `process.platform-process.arch`; never the machine's hostname. */
    platform: z.string(),
    timeout_ms: z.number().int().positive(),
    selection: z
      .object({
        items: z.array(z.string()).nullable(),
        scenario: z.string().nullable(),
        latency_set: z.boolean(),
      })
      .strict(),
    counts: z
      .object({
        items: z.number().int().nonnegative(),
        lines: z.number().int().nonnegative(),
        answered: z.number().int().nonnegative(),
        errors: z.number().int().nonnegative(),
        /** Never answered, never a pass: counted on their own. */
        skipped_missing_env: z
          .object({
            items: z.array(z.string()),
            lines: z.number().int().nonnegative(),
          })
          .strict(),
        cache_hits: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export type RunMeta = z.infer<typeof metaSchema>;
