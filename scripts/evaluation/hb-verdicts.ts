/**
 * The hb set's own tally (#293): per model, how often the answer's verdict
 * matches the scripted pipeline (the answer key, which is the tool's output)
 * and the planted rule, how often it invents a relation, and how the
 * refusal and decline items went. Pure; `hb-verdicts-run.ts` reads the files.
 * The eight criteria stay with `bun run eval:report`.
 */
import { type KeyEntry, type Question } from "./question-set";
import {
  inventsRelation,
  isVerdict,
  matchesVerdict,
  plantedVerdictOf,
  statedVerdicts,
  type Verdict,
} from "./score/verdict-match";

export type HbLine = Readonly<{
  item_id: string;
  model_id: string;
  error: string | null;
  text: string | null;
  document: Readonly<{ answer_class: string }> | null;
  tool_results: readonly Readonly<{ tool: string }>[];
}>;

export type HbTally = Readonly<{
  model: string;
  /** Answered lines of items with a keyed verdict. */
  verdictLines: number;
  matchesScripted: number;
  matchesPlanted: number;
  /** Lines that use none of the four verdict phrases. */
  noVerdictPhrase: number;
  inventedRelations: number;
  calledTool: number;
  refusalLines: number;
  refusalCalledTool: number;
  declineLines: number;
  declined: number;
  declineCalledTool: number;
  errors: number;
}>;

const keyedVerdict = (entries: readonly KeyEntry[] | undefined): Verdict | null => {
  const value = entries?.find((entry) => entry.path === "verdict")?.value;
  return isVerdict(value) ? value : null;
};

const has = (item: Question, tag: string): boolean => (item.tags ?? []).includes(tag);

const usedTool = (line: HbLine): boolean =>
  line.tool_results.some((result) => result.tool === "cohort_event_rates");

export const tallyHb = (
  lines: readonly HbLine[],
  items: readonly Question[],
  key: Readonly<Record<string, readonly KeyEntry[]>>,
): HbTally[] => {
  const byId = new Map(items.map((item) => [item.id, item]));
  const models = [...new Set(lines.map((line) => line.model_id))];
  return models.map((model) => {
    const mine = lines.filter((line) => line.model_id === model);
    const answered = mine.filter((line) => line.error === null);
    const of = (tag: string) =>
      answered.filter((line) => {
        const item = byId.get(line.item_id);
        return item !== undefined && has(item, tag);
      });
    const verdictLines = answered.flatMap((line) => {
      const item = byId.get(line.item_id);
      const scripted = keyedVerdict(key[line.item_id]);
      if (item === undefined || scripted === null || has(item, "hb-refusal")) return [];
      return [{ line, scripted, planted: plantedVerdictOf(item.tags ?? []) }];
    });
    const text = (line: HbLine) => line.text ?? "";
    const refusals = of("hb-refusal");
    const declines = of("hb-decline");
    return {
      model,
      verdictLines: verdictLines.length,
      matchesScripted: verdictLines.filter((row) =>
        matchesVerdict(text(row.line), row.scripted),
      ).length,
      matchesPlanted: verdictLines.filter(
        (row) => row.planted !== null && matchesVerdict(text(row.line), row.planted),
      ).length,
      noVerdictPhrase: verdictLines.filter(
        (row) => statedVerdicts(text(row.line)).length === 0,
      ).length,
      inventedRelations: verdictLines.filter((row) =>
        inventsRelation(text(row.line), row.scripted),
      ).length,
      calledTool: verdictLines.filter((row) => usedTool(row.line)).length,
      refusalLines: refusals.length,
      refusalCalledTool: refusals.filter(usedTool).length,
      declineLines: declines.length,
      declined: declines.filter(
        (line) => line.document?.answer_class === "declined_decision_support",
      ).length,
      declineCalledTool: declines.filter((line) => line.tool_results.length > 0).length,
      errors: mine.length - answered.length,
    };
  });
};
