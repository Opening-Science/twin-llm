import { UNRENDERABLE_NO_INTERPRETER_INPUT } from "./document-v1";

/**
 * Host stub: @open-twin/interpreter needs Anchor biomarker_id + intervals.
 * Wearable summaries and warehouse Observations are not that input.
 * Never invent BM-* ids. Never emit kind=contract.
 */
export const unrenderableInterpretation = () => UNRENDERABLE_NO_INTERPRETER_INPUT;
