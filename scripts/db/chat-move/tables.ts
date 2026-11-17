/**
 * How each column of threads, turns and model_responses is copied into
 * conversations, exchanges and answers (.plans/compare-rewrite/DATA-MODEL.md,
 * B.1 to B.3). One list for the mirror triggers, the backfill and the parity
 * check, so the three can never map a column differently.
 *
 * Pure: SQL names and SQL text only.
 */

/**
 * How a value changes on the way:
 *   copy       stored as it is (sealed text byte for byte, numbers exactly)
 *   utc        timestamp(3) holding UTC becomes timestamptz(3), same instant
 *   origin     the `scheduled` flag becomes `person` or `schedule`
 *   state      the upper-case status becomes the lower-case state
 */
export type CopyKind = "copy" | "utc" | "origin" | "state";

export type ColumnCopy = Readonly<{ from: string; to: string; kind: CopyKind }>;

export type TableMove = Readonly<{
  from: string;
  to: string;
  columns: readonly ColumnCopy[];
  /** Columns of the new table that no old column fills. */
  added: readonly string[];
}>;

const copy = (from: string, to: string): ColumnCopy => ({ from, to, kind: "copy" });
const utc = (from: string, to: string): ColumnCopy => ({ from, to, kind: "utc" });

export const CONVERSATIONS: TableMove = {
  from: "threads",
  to: "conversations",
  columns: [
    copy("id", "id"),
    copy("userId", "owner_id"),
    copy("title", "title_sealed"),
    utc("createdAt", "started_at"),
    utc("updatedAt", "last_activity_at"),
  ],
  added: [],
};

export const EXCHANGES: TableMove = {
  from: "turns",
  to: "exchanges",
  columns: [
    copy("id", "id"),
    copy("threadId", "conversation_id"),
    utc("createdAt", "asked_at"),
    copy("prompt", "question_sealed"),
    copy("label", "bubble_text_sealed"),
    copy("skill", "skill_name"),
    { from: "scheduled", to: "origin", kind: "origin" },
  ],
  added: ["schedule_id"],
};

export const ANSWERS: TableMove = {
  from: "model_responses",
  to: "answers",
  columns: [
    copy("id", "id"),
    copy("turnId", "exchange_id"),
    copy("modelId", "answerer_ref"),
    copy("modelName", "answerer_label"),
    copy("position", "column_index"),
    { from: "status", to: "state", kind: "state" },
    copy("text", "body_sealed"),
    copy("reasoningText", "reasoning_sealed"),
    copy("attribution", "evidence_sealed"),
    copy("responseDocument", "document_sealed"),
    copy("toolParts", "tool_trace_sealed"),
    copy("timeToFirstTokenMs", "first_token_ms"),
    copy("tokensPerSecond", "tokens_per_second"),
    copy("inputTokens", "input_tokens"),
    copy("outputTokens", "output_tokens"),
    copy("totalTokens", "total_tokens"),
    copy("costUsd", "cost_usd"),
    utc("createdAt", "opened_at"),
    utc("completedAt", "closed_at"),
  ],
  added: [],
};

/** Parents first: the order the backfill copies in. */
export const CHAT_MOVES: readonly TableMove[] = [CONVERSATIONS, EXCHANGES, ANSWERS];

const quoted = (name: string): string => `"${name}"`;

/**
 * The SQL for one new column's value, read from the old row named `row`
 * (a table alias, or NEW inside a trigger).
 */
export const valueOf = (row: string, column: ColumnCopy): string => {
  const source = `${row}.${quoted(column.from)}`;
  switch (column.kind) {
    case "copy":
      return source;
    case "utc":
      return `(${source} AT TIME ZONE 'UTC')`;
    case "origin":
      return `(CASE WHEN ${source} THEN 'schedule' ELSE 'person' END)::"exchange_origin"`;
    case "state":
      return `lower(${source}::text)::"answer_state"`;
  }
};

/** The new table's column list, quoted, in map order. */
export const targetColumns = (move: TableMove): string =>
  move.columns.map((column) => quoted(column.to)).join(", ");

/** The mapped values of the old row `row`, in the order of `targetColumns`. */
export const sourceValues = (move: TableMove, row: string): string =>
  move.columns.map((column) => valueOf(row, column)).join(", ");
