import { EMPTY_VALUE, formatDate, formatNumber } from "@/infrastructure/format-measure";
import { DNA_ASK_TOOL, GENOME_REPORT_TOOL } from "@/packages/carbon-x/constants";
import { GBD_MODEL_TOOL } from "@/packages/gbd-mcp/constants";
import { GUIDELINE_MODEL_TOOL } from "@/packages/guidelines/constants";
import { KNOWLEDGE_MODEL_TOOL } from "@/packages/knowledge/constants";

/**
 * A tool call as the answer column shows it: what was asked, in plain words,
 * how it ended and how many rows it read. Pure, so the live stream (in the
 * browser) and a saved answer (on the server) build the same card.
 *
 * Only named arguments are kept, each as display text. Tool outputs never
 * reach a card: the row count is the one thing read from them, and a refusal
 * shows a fixed sentence by its code, never the tool's own words.
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
  /** Why a refused call has no rows, in a fixed sentence. */
  note: string | null;
}>;

const TITLES: Readonly<Record<string, string>> = {
  list_subjects: "Listed cohort subjects",
  subject_window: "Checked a subject's date range",
  observations_for_subject: "Read observations",
  latest_by_loinc: "Read latest values",
  summary_stats: "Summarised a measure",
  trend: "Fitted a trend",
  baseline_deviation: "Compared with a baseline",
  coverage: "Checked data coverage",
  compare_windows: "Compared two windows",
  show_view: "Drew a chart",
  list_views: "Listed this thread's charts",
  open_view: "Reopened a chart",
  [GUIDELINE_MODEL_TOOL]: "Searched guidelines",
  [GBD_MODEL_TOOL]: "Looked up population data",
  [KNOWLEDGE_MODEL_TOOL]: "Searched TwinLLM notes",
  [GENOME_REPORT_TOOL]: "Read the released genome report",
  [DNA_ASK_TOOL]: "Asked Carbon-X (research model) about a variant",
};

export const toolTitle = (tool: string): string => {
  const known = TITLES[tool];
  if (known) return known;
  const words = tool.replace(/[_.-]+/g, " ").trim();
  return words === "" ? "Tool call" : words.charAt(0).toUpperCase() + words.slice(1);
};

const REFUSAL_NOTES: Readonly<Record<string, string>> = {
  SUBJECT_SCOPE_VIOLATION: "That subject is outside this session's scope.",
  ROW_CAP_EXCEEDED: "Too many rows in this window; nothing was read.",
  MIXED_UNITS: "The readings use more than one unit, so they were not combined.",
  COHORT_TOOLS_OFF: "The cohort record tools are turned off.",
  SUBJECT_REQUIRED: "A cohort measure needs a subject.",
  NOT_AUDITED: "The read was not recorded, so nothing was drawn.",
  UNKNOWN_MEASURE: "That measure is not a LOINC code or a known wearable key.",
  VIEW_NOT_FOUND: "No chart with that id in this thread.",
  VIEW_NOT_ALLOWED: "This skill does not draw that kind of view.",
  GENOME_NOT_PERMITTED: "Genome tools run only in personal mode on this machine.",
  NO_REPORT: "No genome report has been released yet.",
  RSID_NOT_IN_REPORT: "That variant is not in the released report.",
  NO_CALL: "The report has no call at that variant, so nothing was asked.",
  INCOMPLETE_ROW: "The report has no position for that variant.",
  BUILD_MISMATCH: "The report is not on GRCh38, so no reference window was built.",
  BUILD_UNKNOWN: "The report's build is unknown, so no reference window was built.",
  REF_MISMATCH:
    "The reported reference allele does not match GRCh38, so nothing was asked.",
  REF_STRAND_MISMATCH: "The report is on the other strand, so nothing was asked.",
  OUT_OF_RANGE: "That position is outside the reference chromosome.",
  REFERENCE_NOT_CONFIGURED: "No local GRCh38 reference is set up.",
  REFERENCE_MISSING: "The local GRCh38 reference lacks that chromosome.",
  REFERENCE_UNREADABLE: "The local GRCh38 reference could not be read.",
  CARBON_X_NOT_LOCAL: "Carbon-X is not on this machine, so nothing was sent.",
  CARBON_X_UNREACHABLE: "The local Carbon-X sidecar is not running.",
  CARBON_X_TIMEOUT: "The local Carbon-X sidecar did not answer in time.",
  CARBON_X_FAILED: "The local Carbon-X sidecar did not return an answer.",
};

const REFUSED = "The tool declined this call.";

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
 * A chart counts the points it drew. Anything else is unknown, not zero.
 */
export const rowCountOf = (output: unknown): number | null => {
  if (refusalCode(output) !== null) return 0;
  if (Array.isArray(output)) return output.length;
  if (!isRecord(output)) return null;
  if (Array.isArray(output.rows)) return output.rows.length;
  if (Array.isArray(output.subjects)) return output.subjects.length;
  if (Array.isArray(output.views)) return output.views.length;
  if ("n_observations" in output) return count(output.n_observations);
  if (Array.isArray(output.codes)) return sumN(...output.codes);
  if ("baseline" in output && "target" in output)
    return sumN(output.baseline, output.target);
  if ("window_a" in output && "window_b" in output)
    return sumN(output.window_a, output.window_b);
  if (isRecord(output.spec) && Array.isArray(output.spec.points))
    return output.spec.points.length;
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

const span = (value: unknown): string | null => {
  if (!isRecord(value)) return null;
  const start = day(value.start);
  const end = day(value.end);
  return start && end ? `${start} – ${end}` : null;
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
  ["Variant", (input) => text(input.rsid)],
  ["Window", (input) => span(input.window) ?? span(input)],
  ["Baseline", (input) => span(input.baseline)],
  ["Target", (input) => span(input.target)],
  ["Window A", (input) => span(input.window_a)],
  ["Window B", (input) => span(input.window_b)],
  ["Subject", (input) => text(input.subject ?? input.subject_ref)],
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
    note: code === null ? null : (REFUSAL_NOTES[code] ?? REFUSED),
  };
};

export const STATE_LABELS: Readonly<Record<ToolCardState, string>> = {
  running: "Running",
  done: "Done",
  refused: "Refused",
  error: "Failed",
};

/** `12 rows`, `1 row`; nothing when unknown. */
export const rowsLabel = (rowCount: number | null): string | null =>
  rowCount === null
    ? null
    : `${formatNumber(rowCount, 0)} ${rowCount === 1 ? "row" : "rows"}`;
