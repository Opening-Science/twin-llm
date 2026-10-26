/**
 * Counts for a set of training conversations: per family, template, style and
 * outcome, the share of no-data and unit conversations, and length
 * percentiles. Pure. Lengths are characters; the token figures are a rough
 * estimate (characters / 4), since the trainer's tokenizer is not here.
 */
import { NO_DATA_OUTCOMES } from "./family-kit";

export type StatsMeta = Readonly<{
  family: string;
  outcome: string;
  template_id: string;
  template_group: string;
  style: string;
  typo: boolean;
}>;

export type StatsRow = Readonly<{ meta: StatsMeta; chars: number }>;

const UNIT_FAMILIES: ReadonlySet<string> = new Set(["unit_mismatch", "unit_conversion"]);

const countBy = (values: readonly string[]): Record<string, number> =>
  Object.fromEntries(
    [...Map.groupBy(values, (value) => value).entries()]
      .map(([key, group]) => [key, group.length] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
  );

/** Nearest-rank percentile of sorted values; 0 for none. */
export const percentile = (sorted: readonly number[], p: number): number => {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? 0;
};

const spread = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted.at(-1) ?? 0,
  };
};

const share = (part: number, whole: number): number =>
  whole === 0 ? 0 : Math.round((part / whole) * 10_000) / 10_000;

export const approxTokens = (chars: number): number => Math.ceil(chars / 4);

/** Characters a trainer sees in one record's messages: contents and tool calls. */
export const messageChars = (messages: readonly unknown[]): number =>
  messages.reduce<number>((total, message) => {
    const content = Reflect.get(Object(message), "content");
    const calls = Reflect.get(Object(message), "tool_calls");
    return (
      total +
      (typeof content === "string" ? content.length : 0) +
      (Array.isArray(calls) ? JSON.stringify(calls).length : 0)
    );
  }, 0);

export type ConversationStats = ReturnType<typeof conversationStats>;

export const conversationStats = (rows: readonly StatsRow[], toolsChars: number) => {
  const metas = rows.map((row) => row.meta);
  const chars = rows.map((row) => row.chars);
  return {
    conversations: rows.length,
    by_family: countBy(metas.map((meta) => meta.family)),
    by_outcome: countBy(metas.map((meta) => meta.outcome)),
    by_style: countBy(metas.map((meta) => meta.style)),
    by_template_group: countBy(metas.map((meta) => meta.template_group)),
    by_template: countBy(metas.map((meta) => meta.template_id)),
    typo_share: share(metas.filter((meta) => meta.typo).length, rows.length),
    no_data_share: share(
      metas.filter((meta) => NO_DATA_OUTCOMES.has(meta.outcome)).length,
      rows.length,
    ),
    unit_share: share(
      metas.filter(
        (meta) => UNIT_FAMILIES.has(meta.family) || meta.outcome === "MIXED_UNITS",
      ).length,
      rows.length,
    ),
    message_chars: spread(chars),
    approx_tokens: {
      method: "characters / 4, rounded up; rough",
      messages: spread(chars.map(approxTokens)),
      tools: approxTokens(toolsChars),
    },
  };
};
