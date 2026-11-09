import {
  MAP_REFUSAL_CODES,
  SHOW_VIEW_REFUSAL_CODES,
  SHOW_VIEW_TOOL,
  toChatView,
  viewReadings,
} from "@/infrastructure/chat-view";
import { GENOME_NOT_PERMITTED } from "@/infrastructure/data-mode-policy";
import { EMPTY_VALUE, formatDate, formatNumber } from "@/infrastructure/format-measure";
import { toolTitle } from "@/infrastructure/tool-titles";
import { DNA_ASK_TOOL, GENOME_REPORT_TOOL } from "@/packages/carbon-x/constants";

import { toolCodeSentence } from "./tool-code-sentences";

export { toolTitle };

/**
 * A tool call as the answer column shows it: what was asked, in plain words,
 * how it ended and how many rows it read. Pure, so the live stream (in the
 * browser) and a saved answer (on the server) build the same card.
 *
 * Only named arguments are kept, each as display text. Tool outputs never
 * reach a card: the row count is the one thing read from them, and a refusal
 * shows a fixed sentence by its code (`tool-code-sentences.ts`), never the
 * tool's own words.
 */

export type ToolCardState = "running" | "done" | "refused" | "error";

export type ToolCardArg = Readonly<{ label: string; value: string }>;

export type ToolCard = Readonly<{
  id: string;
  /** The model-facing tool name, shown in the fold-out. */
  tool: string;
  title: string;
  /** The first ones are the summary; the fold-out lists them all. */
  args: readonly ToolCardArg[];
  state: ToolCardState;
  /** Rows the call read; null while it runs, after an error or when unknown. */
  rowCount: number | null;
  /** Why a refused call has no rows, in a fixed plain sentence: the step's title. */
  note: string | null;
  /** A refused call's code (`NO_ROWS`), for the fold-out; absent otherwise. */
  refusalCode?: string;
  /**
   * True when a gate turned the call away before it read anything or wrote
   * an audit row (`VIEW_NOT_ALLOWED`): it did not run. Absent for a call that
   * ran, including one refused with `NO_ROWS`, which is audited with 0 rows.
   */
  notRun?: true;
  /**
   * The measure's display name as the call's own output gives it (a chart's
   * label, or the `display` of a row with the asked code), for the step
   * line; absent when the output names none.
   */
  measureName?: string;
}>;

/**
 * Codes a tool returns before it runs: no read, no audit row. Every other
 * code comes back from a call that ran: the query tools return theirs
 * (`isToolRefusal`, `packages/query-tools/refusals.ts`) from inside the audit
 * wrapper, which records them with 0 rows, and the genome and live tools audit
 * theirs too. The genome permit is checked before `genome_report` and
 * `dna_ask` write anything; `genome_variants` audits it.
 */
const NOT_RUN_CODES: Readonly<Record<string, readonly string[]>> = {
  [SHOW_VIEW_TOOL]: [...SHOW_VIEW_REFUSAL_CODES, ...MAP_REFUSAL_CODES],
  [GENOME_REPORT_TOOL]: [GENOME_NOT_PERMITTED],
  [DNA_ASK_TOOL]: [GENOME_NOT_PERMITTED],
};

/** Did a refusal with this code stop the call before it ran? */
export const refusedBeforeRun = (tool: string, code: string): boolean =>
  NOT_RUN_CODES[tool]?.includes(code) ?? false;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const refusalCode = (output: unknown): string | null =>
  isRecord(output) && typeof output.code === "string" && typeof output.error === "string"
    ? output.code
    : null;

const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;

const sumN = (...windows: readonly unknown[]): number | null => {
  const ns = windows.map((window) => (isRecord(window) ? count(window.n) : null));
  return ns.every((n) => n !== null) ? ns.reduce((a, b) => a + b, 0) : null;
};

/**
 * Rows read, the way the audit row counts them (`packages/query-tools/tools.ts`
 * and the search tools): list lengths, `n`, or the sum over windows or codes.
 * A view counts the readings it was drawn from. Anything else is unknown, not zero.
 */
export const rowCountOf = (output: unknown): number | null => {
  if (refusalCode(output) !== null) return 0;
  const view = toChatView(output);
  if (view !== null) return viewReadings(view);
  if (Array.isArray(output)) return output.length;
  if (!isRecord(output)) return null;
  if (Array.isArray(output.rows)) return output.rows.length;
  if (Array.isArray(output.subjects)) return output.subjects.length;
  if (Array.isArray(output.views)) return output.views.length;
  if ("n_observations" in output) return count(output.n_observations);
  // cohort_position: `n` is people with a value; the audit counts rows read.
  if ("rows_read" in output) return count(output.rows_read);
  if (Array.isArray(output.codes)) return sumN(...output.codes);
  if ("baseline" in output && "target" in output)
    return sumN(output.baseline, output.target);
  if ("window_a" in output && "window_b" in output)
    return sumN(output.window_a, output.window_b);
  return count(output.n);
};

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : typeof value === "number" && Number.isFinite(value)
      ? formatNumber(value, Number.isInteger(value) ? 0 : 1)
      : null;

const MAX_QUERY = 80;

const clipped = (value: string): string =>
  value.length > MAX_QUERY ? `${value.slice(0, MAX_QUERY - 1)}…` : value;

/** `2026-10-01` as `1 Oct 2026`; a datetime keeps its day; anything else as written. */
const day = (value: unknown): string | null => {
  const raw = text(value);
  if (raw === null) return null;
  const date = raw.slice(0, 10);
  const formatted = formatDate(date);
  return formatted === EMPTY_VALUE ? raw : formatted;
};

/** Between a window's two days on a card; the step line says "to" instead. */
export const RANGE_DASH = " – ";

const span = (value: unknown): string | null => {
  if (!isRecord(value)) return null;
  const start = day(value.start);
  const end = day(value.end);
  return start && end ? `${start}${RANGE_DASH}${end}` : null;
};

const list = (value: unknown): string | null =>
  Array.isArray(value)
    ? value.flatMap((item) => text(item) ?? []).join(", ") || null
    : text(value);

/** The named arguments worth showing, in reading order; everything else stays behind. */
const ARG_READERS: readonly (readonly [
  string,
  (input: Record<string, unknown>) => string | null,
])[] = [
  ["Measure", (input) => list(input.measure ?? input.loinc ?? input.key)],
  ["Kind", (input) => text(input.kind)],
  ["Source", (input) => text(input.source)],
  ["Sport", (input) => text(input.sport)],
  ["Per", (input) => text(input.aggregation)],
  ["Variant", (input) => text(input.rsid)],
  ["Window", (input) => span(input.window) ?? span(input)],
  ["Baseline", (input) => span(input.baseline)],
  ["Target", (input) => span(input.target)],
  ["Window A", (input) => span(input.window_a)],
  ["Window B", (input) => span(input.window_b)],
  ["Subject", (input) => text(input.subject ?? input.subject_ref)],
  ["Status", (input) => text(input.status)],
  ["Code", (input) => text(input.code)],
  ["Cohort", (input) => text(input.cohort_id)],
  ["Chart", (input) => text(input.id)],
  ["Search", (input) => (text(input.query) ? clipped(text(input.query)!) : null)],
  ["Cause", (input) => text(input.cause)],
  ["Location", (input) => text(input.location)],
  ["Year", (input) => text(input.year)],
  ["Sex", (input) => text(input.sex)],
  ["Age", (input) => text(input.age)],
  ["Limit", (input) => text(input.limit)],
];

export const toolArgs = (input: unknown): ToolCardArg[] => {
  if (!isRecord(input)) return [];
  return ARG_READERS.flatMap(([label, read]) => {
    const value = read(input);
    return value === null ? [] : [{ label, value }];
  });
};

/** Views drawn for one measure, whose label is that measure's display name. */
const MEASURE_VIEWS: ReadonlySet<string> = new Set([
  "chart.timeseries",
  "chart.compare",
  "biomarker.card",
]);

/**
 * The name the data itself gives the asked measure: a measure view's label,
 * or the `display` of a returned row with the asked code. The same names the
 * answer's charts are titled with; nothing is looked up or made up here.
 */
export const measureNameOf = (input: unknown, output: unknown): string | null => {
  const view = toChatView(output);
  if (view !== null) {
    const label = isRecord(view.spec) ? text(view.spec.label) : null;
    return MEASURE_VIEWS.has(view.kind) ? label : null;
  }
  if (!isRecord(input)) return null;
  const code = text(input.measure ?? input.loinc);
  const rows = Array.isArray(output)
    ? output
    : isRecord(output) && Array.isArray(output.rows)
      ? output.rows
      : [];
  const row = rows.find(
    (item): item is Record<string, unknown> =>
      isRecord(item) && code !== null && item.loinc === code,
  );
  return row === undefined ? null : text(row.display);
};

/** A tool part, live or replayed from the stored column. */
export type ToolPartLike = Readonly<{
  toolCallId: string;
  tool: string;
  state: string;
  input?: unknown;
  output?: unknown;
}>;

const ENDED: Readonly<Record<string, "done" | "error">> = {
  "output-available": "done",
  "output-error": "error",
  "output-denied": "error",
};

const measureField = (name: string | null): { measureName?: string } =>
  name === null ? {} : { measureName: name };

/**
 * One card per call, in order. `storedRowCount` is the audit row's count
 * from the stored column; it wins over the count read from the output, which
 * is the same number for every tool whose audit row the part matched.
 */
export const toolCard = (
  part: ToolPartLike,
  storedRowCount?: number | null,
): ToolCard => {
  const ended = ENDED[part.state];
  const code = ended === "done" ? refusalCode(part.output) : null;
  const state: ToolCardState =
    ended === undefined ? "running" : code !== null ? "refused" : ended;
  return {
    id: part.toolCallId,
    tool: part.tool,
    title: toolTitle(part.tool),
    args: toolArgs(part.input),
    state,
    rowCount:
      state === "done" || state === "refused"
        ? (storedRowCount ?? rowCountOf(part.output))
        : null,
    note: code === null ? null : toolCodeSentence(part.tool, code),
    ...(code === null ? {} : { refusalCode: code }),
    ...(code !== null && refusedBeforeRun(part.tool, code) ? { notRun: true } : {}),
    ...measureField(state === "done" ? measureNameOf(part.input, part.output) : null),
  };
};

/**
 * How a call ended, as every place that shows it names it: the card's badge,
 * the step trace and the Markdown export. A call refused before it ran
 * (`notRun`) is `refused`; one that ran and came back with a code (`NO_ROWS`,
 * audited with 0 rows) is `no-data`, so it is never called refused.
 */
export type ToolOutcome = "running" | "done" | "no-data" | "refused" | "error";

export const toolOutcome = (card: ToolCard): ToolOutcome =>
  card.state === "refused" ? (card.notRun === true ? "refused" : "no-data") : card.state;

export const OUTCOME_LABELS: Readonly<Record<ToolOutcome, string>> = {
  running: "Running",
  done: "Done",
  "no-data": "No data",
  refused: "Refused",
  error: "Failed",
};

/** `12 rows`, `1 row`; nothing when unknown. */
export const rowsLabel = (rowCount: number | null): string | null =>
  rowCount === null
    ? null
    : `${formatNumber(rowCount, 0)} ${rowCount === 1 ? "row" : "rows"}`;
