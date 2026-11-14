import type { AppendInput } from "@/packages/audit/append";

import { WEARABLE_SOURCE_IDS, type WearableSourceId } from "./wearable-provenance";
import {
  SOURCE_RULES_VERSION,
  type SourceDecision,
  type SourceDecisionKind,
} from "./wearable-source-rules";

/**
 * The audit row for the wearable sources a chat turn or a screen read (#464).
 * The tool name lists every source with a summary, in a fixed order
 * (`wearable.sources.oura+whoop`), because an audit row stores its args only
 * as a hash; the args hold the rule set's version and, per decision, the
 * measure, the outcome, the source used and the others. Never a value, a unit
 * or a day, as for any personal read (#143). `rowCount` is the number of
 * decisions.
 */
export const WEARABLE_SOURCES_TOOL_PREFIX = "wearable.sources." as const;

export const wearableSourcesTool = (sources: readonly WearableSourceId[]): string =>
  `${WEARABLE_SOURCES_TOOL_PREFIX}${WEARABLE_SOURCE_IDS.filter((id) =>
    sources.includes(id),
  ).join("+")}`;

export type AuditedDecision = Readonly<{
  measure: SourceDecision["measure"];
  outcome: SourceDecisionKind;
  /** The source whose reading is used; null when it is held back. */
  used: WearableSourceId | null;
  others: readonly WearableSourceId[];
  reason: string | null;
}>;

export const auditedDecision = (decision: SourceDecision): AuditedDecision => {
  switch (decision.kind) {
    case "only_source":
      return {
        measure: decision.measure,
        outcome: decision.kind,
        used: decision.chosen.source,
        others: [],
        reason: null,
      };
    case "agree":
    case "evidence":
      return {
        measure: decision.measure,
        outcome: decision.kind,
        used: decision.chosen.source,
        others: decision.others.map((reading) => reading.source),
        reason: null,
      };
    case "held_back":
      return {
        measure: decision.measure,
        outcome: decision.kind,
        used: null,
        others: decision.readings.map((reading) => reading.source),
        reason: decision.reason,
      };
  }
};

/** Null when no source had a summary: nothing was read, so nothing is written. */
export const wearableSourcesEvent = (
  input: Readonly<{
    actor: string;
    sessionId: string;
    sources: readonly WearableSourceId[];
    decisions: readonly SourceDecision[];
  }>,
): AppendInput | null => {
  if (input.sources.length === 0) return null;
  const decisions = input.decisions.map(auditedDecision);
  const outcomes = (kind: SourceDecisionKind) =>
    decisions.filter((decision) => decision.outcome === kind).length;
  return {
    actor: input.actor,
    sessionId: input.sessionId,
    subjectRef: null,
    tool: wearableSourcesTool(input.sources),
    args: { rules: SOURCE_RULES_VERSION, decisions },
    result: {
      only_source: outcomes("only_source"),
      agree: outcomes("agree"),
      evidence: outcomes("evidence"),
      held_back: outcomes("held_back"),
    },
    rowCount: decisions.length,
  };
};

/** The sources with a summary, from the four a turn or a screen loads. */
export const summarySources = (
  summaries: Readonly<{
    oura: unknown;
    whoop: unknown;
    googleHealth: unknown;
    vitronic: unknown;
  }>,
): readonly WearableSourceId[] => [
  ...(summaries.oura == null ? [] : (["oura"] as const)),
  ...(summaries.whoop == null ? [] : (["whoop"] as const)),
  ...(summaries.googleHealth == null ? [] : (["google_health"] as const)),
  ...(summaries.vitronic == null ? [] : (["bodyloop"] as const)),
];
