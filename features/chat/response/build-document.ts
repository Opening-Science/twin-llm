import type { AppliedEffort } from "@/infrastructure/chat-effort";
import { toChatView } from "@/infrastructure/chat-view";
import type { DataMode } from "@/infrastructure/data-mode-policy";
import type { ParsedTwinAnswer } from "@/infrastructure/parse-twin-answer";
import type { UiContext } from "@/infrastructure/ui-context";

import { CHAT_RESPONSE_DOCUMENT } from "../response-document";
import type { GbdSource } from "@/packages/gbd-mcp/collector";
import { GBD_AUDIT_TOOL } from "@/packages/gbd-mcp/constants";
import type { GbdRow } from "@/packages/gbd-mcp/normalize";
import type { GuidelineCitation } from "@/packages/guidelines/collector";
import { GUIDELINE_AUDIT_TOOL } from "@/packages/guidelines/constants";
import type { KnowledgeCitation } from "@/packages/knowledge/collector";
import { KNOWLEDGE_AUDIT_TOOL } from "@/packages/knowledge/constants";
import type { LiteratureCitation } from "@/packages/literature/collector";

import {
  type AnswerClass,
  type NextStep,
  RESPONSE_SCHEMA_VERSION,
  type ResponseDocumentV1,
  type ResponseToolCall,
  responseDocumentV1Schema,
  type UncertaintyLevel,
  type UncertaintyReason,
} from "./document-v1";

/**
 * Reference material, not data about a person: guideline passages, GBD
 * population figures, OpenTwin knowledge notes and the specialty literature
 * an agent's `knowledge_search` returns never make an answer
 * `sufficient_data` or `analytics`.
 */
const REFERENCE_TOOLS: ReadonlySet<string> = new Set([
  GUIDELINE_AUDIT_TOOL,
  GBD_AUDIT_TOOL,
  KNOWLEDGE_AUDIT_TOOL,
]);

export const hasSufficientToolRows = (toolCalls: readonly ResponseToolCall[]): boolean =>
  toolCalls.some((row) => row.row_count > 0 && !REFERENCE_TOOLS.has(row.tool));

/**
 * Rows that mean "there was something to read" for next_step. Guideline rows
 * still count here (unchanged since A3); population and knowledge rows do not.
 */
const NOT_READABLE_TOOLS: ReadonlySet<string> = new Set([
  GBD_AUDIT_TOOL,
  KNOWLEDGE_AUDIT_TOOL,
]);

/**
 * What the v1.1 fields are derived from. Every input is something the host
 * observed (parser output, audit rows, collectors, DATA_MODE), never a claim
 * in the model's prose, so the same turn always gets the same class.
 */
type Basis = Readonly<{
  declined: boolean;
  sufficient: boolean;
  abstained: boolean;
  hasGuidelines: boolean;
  hasGbdRows: boolean;
  hasKnowledge: boolean;
  hasLiterature: boolean;
  hallucinatedCount: number;
  toolCalls: readonly ResponseToolCall[];
  modelStatement: string | null;
  mode: DataMode;
  offeredKeyCount: number;
}>;

const deriveAnswerClass = (basis: Basis): AnswerClass => {
  if (basis.declined) return "declined_decision_support";
  return basis.sufficient ? "analytics" : "information";
};

/** Fixed order, so two builds of one turn give the same array. */
const deriveUncertaintyReasons = (basis: Basis): UncertaintyReason[] => {
  if (basis.declined) return ["declined"];
  const checks: ReadonlyArray<readonly [UncertaintyReason, boolean]> = [
    ["no_personal_data", !basis.sufficient],
    ["guideline_only", !basis.sufficient && basis.hasGuidelines],
    ["population_only", !basis.sufficient && basis.hasGbdRows],
    ["knowledge_only", !basis.sufficient && basis.hasKnowledge],
    ["literature_only", !basis.sufficient && basis.hasLiterature],
    ["hallucinated_keys", basis.hallucinatedCount > 0],
    ["tool_returned_no_rows", basis.toolCalls.some((row) => row.row_count === 0)],
    ["no_model_statement", !basis.modelStatement?.trim()],
  ];
  return checks.filter(([, applies]) => applies).map(([reason]) => reason);
};

const MODERATE_REASONS: readonly UncertaintyReason[] = [
  "guideline_only",
  "population_only",
  "knowledge_only",
  "literature_only",
  "tool_returned_no_rows",
];

const deriveUncertaintyLevel = (
  basis: Basis,
  reasons: readonly UncertaintyReason[],
): UncertaintyLevel => {
  if (basis.abstained || basis.declined || basis.hallucinatedCount > 0) return "high";
  return reasons.some((reason) => MODERATE_REASONS.includes(reason)) ? "moderate" : "low";
};

/**
 * Connecting a wearable only helps in personal mode: synthetic mode never
 * reads one (`loadWearableContext`), so there it stays `more_data`.
 */
const deriveNextStep = (basis: Basis): NextStep => {
  if (basis.declined) return "consult_clinician";
  if (basis.sufficient) return "none";
  const nothingToRead =
    basis.offeredKeyCount === 0 &&
    !basis.toolCalls.some(
      (row) => row.row_count > 0 && !NOT_READABLE_TOOLS.has(row.tool),
    );
  return basis.mode === "personal" && nothingToRead ? "connect_wearable" : "more_data";
};

/**
 * True when a tool output of the turn is a `twin.body` view. The body on its
 * focus is reference anatomy shown to the person, so like a guideline passage
 * it keeps an answer from being withheld; it never makes the answer
 * `sufficient_data`, which only rows about a person do.
 */
export const twinBodyShown = (outputs: readonly unknown[]): boolean =>
  outputs.some((output) => toChatView(output)?.kind === "twin.body");

export const buildResponseDocumentV1 = (input: {
  readonly parsed: ParsedTwinAnswer;
  readonly toolCalls: readonly ResponseToolCall[];
  readonly mode: DataMode;
  readonly gbdSources?: readonly GbdSource[];
  readonly gbdRows?: readonly GbdRow[];
  readonly guidelineSources?: readonly GuidelineCitation[];
  readonly knowledgeSources?: readonly KnowledgeCitation[];
  /** Specialty literature an agent's search returned (#236). */
  readonly literatureSources?: readonly LiteratureCitation[];
  /** The skill the turn ran under (`sleep`), or null. */
  readonly skill?: string | null;
  /** The turn's UI context (#47), or null. */
  readonly uiContext?: UiContext | null;
  /** A `twin.body` view was shown this turn (`twinBodyShown`). */
  readonly twinBody?: boolean;
  /** The effort the turn ran at (#366), or null when the caller set none. */
  readonly effort?: AppliedEffort | null;
}): ResponseDocumentV1 => {
  // Only keys the prompt offered count; an invented key cannot stop abstaining.
  const evidence_keys = [...input.parsed.evidenceKeys];
  const hallucinated_keys = [...input.parsed.hallucinatedKeys];
  const sufficient_data =
    evidence_keys.length > 0 || hasSufficientToolRows(input.toolCalls);
  const guidelineSources = [...(input.guidelineSources ?? [])];
  const knowledgeSources = [...(input.knowledgeSources ?? [])];
  const literatureSources = [...(input.literatureSources ?? [])];
  const gbdRows = [...(input.gbdRows ?? [])];
  // Reference material alone, or the body twin on its focus, is still an
  // answer to show, with answer_class information.
  const abstained =
    !sufficient_data &&
    guidelineSources.length === 0 &&
    knowledgeSources.length === 0 &&
    literatureSources.length === 0 &&
    gbdRows.length === 0 &&
    input.twinBody !== true;
  const basis: Basis = {
    declined: input.parsed.declined,
    sufficient: sufficient_data,
    abstained,
    hasGuidelines: guidelineSources.length > 0,
    hasGbdRows: gbdRows.length > 0,
    hasKnowledge: knowledgeSources.length > 0,
    hasLiterature: literatureSources.length > 0,
    hallucinatedCount: hallucinated_keys.length,
    toolCalls: input.toolCalls,
    modelStatement: input.parsed.uncertaintyText,
    mode: input.mode,
    offeredKeyCount: input.parsed.offeredKeyCount,
  };
  const reasons = deriveUncertaintyReasons(basis);

  const document = {
    schema_version: RESPONSE_SCHEMA_VERSION,
    intended_use: CHAT_RESPONSE_DOCUMENT.intended_use,
    not_for_diagnostic_use: CHAT_RESPONSE_DOCUMENT.not_for_diagnostic_use,
    sufficient_data,
    abstained,
    answer_class: deriveAnswerClass(basis),
    data_basis: {
      evidence_keys,
      hallucinated_keys,
      tool_calls: [...input.toolCalls],
      sources: {
        gbd: [...(input.gbdSources ?? [])],
        guidelines: guidelineSources,
        knowledge: knowledgeSources,
        literature: literatureSources,
      },
      gbd_rows: gbdRows,
    },
    uncertainty: {
      model_statement: input.parsed.uncertaintyText,
      level: deriveUncertaintyLevel(basis, reasons),
      reasons,
    },
    next_step: deriveNextStep(basis),
    // A declined reply is not narration about data, even if a tool returned rows.
    interpretation:
      sufficient_data && !basis.declined
        ? {
            kind: "narration" as const,
            text: input.parsed.answerText,
            narration_is_unverified: true as const,
          }
        : { kind: "none" as const },
    // Only present on a skill turn, so documents without one are unchanged.
    ...(input.skill ? { skill: input.skill } : {}),
    // Only present when the turn carried one, so other documents are unchanged.
    ...(input.uiContext ? { ui_context: input.uiContext } : {}),
    // Only present when the caller set one (the chat does; the eval harness not).
    ...(input.effort
      ? {
          effort: {
            level: input.effort.level,
            thinking: input.effort.thinking,
            max_steps: input.effort.maxSteps,
            review: input.effort.review,
          },
        }
      : {}),
  };

  return responseDocumentV1Schema.parse(document);
};
