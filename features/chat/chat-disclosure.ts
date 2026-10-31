import { type DataMode, requestDataMode } from "@/infrastructure/data-mode-policy";
import {
  CATEGORY,
  type DisclosureCategory,
  type ModelDisclosure,
  type ValueRef,
} from "@/infrastructure/disclosure-ledger";
import { offeredSummaries, type WearableSummaries } from "@/infrastructure/offered-keys";

/**
 * What one chat answer's model requests carry, for the disclosure ledger
 * (#140): the categories, and the stored values the prompt builder put in
 * as references (the wearable and BodyLoop keys the Twin prompt lists, and
 * the ids of the twin notes it loaded). Never a value. Each HTTP request of
 * the turn is recorded with this, because each one sends the turn again.
 * Free text (the person's own words, the model's answers, tool results) is
 * named as a category; the recording fetch checks each request's text for
 * stored values (#346) and the row records the kinds and counts found.
 */

export type ChatDisclosureInput = Readonly<{
  actor: string;
  turnId: string;
  threadId: string | null;
  mode: DataMode;
  messageCount: number;
  wearables: WearableSummaries;
  noteIds: readonly string[];
  /** True when the turn offers tools, whose results go back to the model. */
  hasTools: boolean;
}>;

const metricRefs = (
  source: ValueRef["source"],
  summary: Readonly<{ metrics: readonly Readonly<{ key: string }>[] }> | null,
): readonly ValueRef[] =>
  summary === null ? [] : summary.metrics.map((metric) => ({ source, key: metric.key }));

export const chatDisclosure = (input: ChatDisclosureInput): ModelDisclosure => {
  const offered = offeredSummaries(input.wearables);
  const wearable = [
    ...metricRefs("wearable", offered.oura),
    ...metricRefs("wearable", offered.whoop),
    ...metricRefs("wearable", offered.googleHealth),
  ];
  const scan = metricRefs("scan", offered.vitronic);
  const notes = input.noteIds.map((id): ValueRef => ({ source: "note", key: id }));
  const hasWearableNarrative = Object.values(input.wearables).some(
    (summary) => summary !== null,
  );
  const categories: readonly DisclosureCategory[] = [
    CATEGORY.question,
    ...(input.messageCount > 1 ? [CATEGORY.history] : []),
    ...(input.wearables.oura !== null ||
    input.wearables.whoop !== null ||
    input.wearables.googleHealth !== null
      ? [CATEGORY.wearable]
      : []),
    ...(input.wearables.vitronic !== null ? [CATEGORY.scan] : []),
    ...(notes.length > 0 ? [CATEGORY.notes] : []),
    ...(input.hasTools ? [CATEGORY.tools] : []),
  ];
  return {
    actor: input.actor,
    sessionId: input.turnId,
    threadId: input.threadId,
    purpose: "chat answer",
    categories,
    refs: [...wearable, ...scan, ...notes],
    synthetic: requestDataMode(input.mode, hasWearableNarrative) === "synthetic",
  };
};

/**
 * The number check of an Ultra answer (#366) sends the answer and the turn's
 * tool results, nothing else: no system prompt, no wearable summary, no notes.
 */
export const numberReviewDisclosure = (turn: ModelDisclosure): ModelDisclosure => ({
  ...turn,
  purpose: "number check",
  categories: [CATEGORY.answers, CATEGORY.tools],
  refs: [],
});
