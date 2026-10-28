import type { NextStep, UncertaintyLevel, UncertaintyReason } from "./document-v1";

export const UNVERIFIED_NARRATION = "Unverified narration";
export const ABSTAIN_BANNER = "Not enough data — this reply is withheld.";
export const GUIDELINE_ATTRIBUTION_LINE =
  "Published guideline passage as reference material, not a statement about this person.";
export const KNOWLEDGE_HEADING = "OpenTwin knowledge";

/** The turn's UI context (#47), as the model was given it. */
export const UI_CONTEXT_HEADING = "On screen when asked";
export const UI_CONTEXT_NOTE =
  "Sent to the model as a short block and recorded in the audit chain. It holds no values.";
export const KNOWLEDGE_ATTRIBUTION_LINE =
  "OpenTwin knowledge notes, Open Science Foundation, CC BY 4.0. They describe TwinLLM itself, not this person.";
export const GUIDELINE_ONLY_BANNER =
  "Answer drawn from published guidelines only; no data about you was used.";
/** Plain sentence for `interpretation.kind = "unrenderable"`; the reason code is never shown. */
export const INTERPRETATION_UNAVAILABLE =
  "No structured interpretation is available for this answer.";

export const toolCallCountLine = (count: number): string =>
  count === 1
    ? "1 data lookup recorded for this answer."
    : `${count} data lookups recorded for this answer.`;

/** Count only: the invented key strings are kept in the document, not shown. */
export const hallucinatedKeysLine = (count: number): string =>
  count === 1
    ? "The model cited 1 key that was not in its context."
    : `The model cited ${count} keys that were not in its context.`;

/** Shown instead of the abstain or guideline banner when the model declined. */
export const DECLINED_BANNER =
  "Declined — this research tool does not make health decisions such as doses or medicine changes.";

/** Level only; `unknown` (a document saved before v1.1) shows no line. */
export const uncertaintyLevelLine = (
  level: Exclude<UncertaintyLevel, "unknown">,
): string => `Uncertainty: ${level} (based on the data behind this answer).`;

/** One plain sentence per reason; the codes themselves are never shown. */
export const UNCERTAINTY_REASON_LINES: Readonly<Record<UncertaintyReason, string>> = {
  no_personal_data: "No person-level data was used.",
  guideline_only: "Only published guidelines support this answer.",
  population_only: "Only population figures support this answer.",
  knowledge_only: "Only OpenTwin notes about TwinLLM itself support this answer.",
  hallucinated_keys: "Some cited keys were not in the model's context.",
  tool_returned_no_rows: "A data lookup returned no rows.",
  no_model_statement: "The model wrote no uncertainty statement.",
  declined: "The request was declined.",
};

/** `none` has no sentence: there is nothing to suggest. */
export const NEXT_STEP_LINES: Readonly<Record<NextStep, string | null>> = {
  none: null,
  more_data: "A firmer answer needs more data than this one had.",
  connect_wearable: "Connect and sync a wearable so answers can use your own data.",
  consult_clinician: "A clinician is the right person to ask about this.",
};
