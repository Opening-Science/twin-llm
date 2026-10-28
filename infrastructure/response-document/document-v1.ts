import { z } from "zod";

import { gbdPopulationInput } from "@/packages/gbd-mcp/input";

import { uiContextSchema } from "../ui-context";
import { CHAT_RESPONSE_DOCUMENT } from "./constants";

/** The builder emits the newest; stored v1 documents still parse (A3). */
export const RESPONSE_SCHEMA_VERSIONS = [
  "twin-llm.response.v1",
  "twin-llm.response.v1.1",
] as const;
export const RESPONSE_SCHEMA_VERSION = "twin-llm.response.v1.1" as const;

export const ANSWER_CLASSES = [
  "information",
  "analytics",
  "declined_decision_support",
] as const;

export const UNCERTAINTY_LEVELS = ["low", "moderate", "high", "unknown"] as const;

/** Host-derived, never read from model text. Shown as plain sentences, never as codes. */
export const UNCERTAINTY_REASONS = [
  "no_personal_data",
  "guideline_only",
  "population_only",
  // Additive: only OpenTwin knowledge notes support the answer.
  "knowledge_only",
  "hallucinated_keys",
  "tool_returned_no_rows",
  "no_model_statement",
  "declined",
] as const;

export const NEXT_STEPS = [
  "none",
  "more_data",
  "connect_wearable",
  "consult_clinician",
] as const;

export const UNRENDERABLE_NO_INTERPRETER_INPUT = {
  kind: "unrenderable",
  reason: "no_interpreter_input",
} as const;

export const toolCallSchema = z.object({
  seq: z.number().int(),
  tool: z.string(),
  args_sha256: z.string().length(64),
  result_sha256: z.string().length(64),
  row_count: z.number().int(),
  ts: z.string(),
});

export const interpretationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("narration"),
    text: z.string(),
    // Additive: defaults so documents saved before it still parse.
    narration_is_unverified: z.literal(true).default(true),
  }),
  z.object({
    kind: z.literal("none"),
  }),
  z.object({
    kind: z.literal("unrenderable"),
    reason: z.literal("no_interpreter_input"),
  }),
]);

export const gbdSourceSchema = z.object({
  tool: z.string(),
  fields: gbdPopulationInput,
});

export const gbdRowSchema = z.object({
  measure: z.string(),
  cause: z.string(),
  location: z.string(),
  year: z.string(),
  sex: z.string(),
  age: z.string(),
  value: z.number(),
  lower: z.number().nullable(),
  upper: z.number().nullable(),
  unit: z.string(),
  source: z.string(),
});

export const guidelineSourceSchema = z.object({
  tool: z.string(),
  id: z.string(),
  title: z.string(),
  year: z.number().int(),
  society: z.string(),
  doi: z.string(),
  url: z.string(),
  licence: z.string(),
  ingestMode: z.string(),
  sectionHeading: z.string().nullable(),
  recommendationId: z.string().nullable(),
  recClass: z.string().nullable(),
  evidenceLevel: z.string().nullable(),
  page: z.string().nullable(),
});

/** One OpenTwin knowledge note section (knowledge/opentwin, CC BY 4.0). */
export const knowledgeSourceSchema = z.object({
  tool: z.string(),
  id: z.string(),
  title: z.string(),
  file: z.string(),
  sectionHeading: z.string(),
  licence: z.string(),
});

export const responseDocumentV1Schema = z.object({
  schema_version: z.enum(RESPONSE_SCHEMA_VERSIONS),
  intended_use: z.literal(CHAT_RESPONSE_DOCUMENT.intended_use),
  not_for_diagnostic_use: z.literal(true),
  sufficient_data: z.boolean(),
  abstained: z.boolean(),
  // v1.1 fields default so a stored v1 document still parses.
  answer_class: z.enum(ANSWER_CLASSES).default("information"),
  data_basis: z.object({
    evidence_keys: z.array(z.string()),
    // Additive (A2): cited keys the prompt never listed. Still v1;
    // defaults to [] so documents saved before it still parse.
    hallucinated_keys: z.array(z.string()).default([]),
    tool_calls: z.array(toolCallSchema),
    sources: z.object({
      gbd: z.array(gbdSourceSchema),
      guidelines: z.array(guidelineSourceSchema),
      // Additive (B4): OpenTwin knowledge notes. Still v1.1; defaults
      // to [] so documents saved before it still parse.
      knowledge: z.array(knowledgeSourceSchema).default([]),
    }),
    gbd_rows: z.array(gbdRowSchema),
  }),
  uncertainty: z.object({
    model_statement: z.string().nullable(),
    level: z.enum(UNCERTAINTY_LEVELS).default("unknown"),
    reasons: z.array(z.enum(UNCERTAINTY_REASONS)).default([]),
  }),
  next_step: z.enum(NEXT_STEPS),
  interpretation: interpretationSchema,
  // Additive (#42): the skill the turn ran under, such as "sleep". Absent on
  // ordinary turns and on documents saved before it, which still parse.
  skill: z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,39}$/)
    .optional(),
  // Additive (#47): what the person had on screen as they asked. Absent when
  // the turn carried none and on documents saved before it.
  ui_context: uiContextSchema.optional(),
});

export type ResponseToolCall = z.infer<typeof toolCallSchema>;
export type ResponseInterpretation = z.infer<typeof interpretationSchema>;
export type ResponseDocumentV1 = z.infer<typeof responseDocumentV1Schema>;
/** What the schema accepts before defaults: a stored v1 document fits this type. */
export type ResponseDocumentInput = z.input<typeof responseDocumentV1Schema>;
export type AnswerClass = (typeof ANSWER_CLASSES)[number];
export type UncertaintyLevel = (typeof UNCERTAINTY_LEVELS)[number];
export type UncertaintyReason = (typeof UNCERTAINTY_REASONS)[number];
export type NextStep = (typeof NEXT_STEPS)[number];
