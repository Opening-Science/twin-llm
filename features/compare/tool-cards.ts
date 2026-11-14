import { formatDate, metricLabel } from "@/infrastructure/format-measure";
import type { StoredToolPart } from "@/infrastructure/model-response-tool-parts";
import { toolTitle } from "@/infrastructure/tool-titles";
import { MEASURES } from "@/packages/personal-data/wearable-measure-codes";

import type { ToolArg, ToolCard } from "./conversation";

/**
 * Tool calls in words (SPEC 5.3, 9.1, 10.5). One rule set turns the live
 * stream's tool parts and a saved answer's stored parts into the same cards,
 * so a reload matches the stream. A card carries named arguments, a row
 * count and a plain sentence for a result code; a tool's output never
 * reaches it, except the display names it gave its measure codes.
 */

/** A tool part as the AI SDK streams it, or as a stored part replays it. */
export type ToolPartLike = Readonly<{
  type: string;
  toolName?: string;
  toolCallId: string;
  state: string;
  input?: unknown;
  output?: unknown;
}>;

const TOOL_PREFIX = "tool-";

/** The tool a part is for, or null when it is not a tool part. */
export const toolNameOf = (part: Readonly<{ type: string; toolName?: string }>) =>
  part.type === "dynamic-tool"
    ? (part.toolName ?? null)
    : part.type.startsWith(TOOL_PREFIX)
      ? part.type.slice(TOOL_PREFIX.length)
      : null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// --- result codes ---------------------------------------------------------------

/**
 * Codes a gate answers with before the tool runs, so no audit row exists.
 * Any other code came back from a call that ran: "no data".
 */
const GATE_CODES: ReadonlySet<string> = new Set([
  "SUBJECT_SCOPE_VIOLATION",
  "COHORT_TOOLS_OFF",
  "CARBON_X_NOT_LOCAL",
  "SIGN_IN",
  "LEARNING_CONSENT_WITHDRAWN",
  "LEARNING_CONSENT_SCOPE",
  "LEARNING_CONSENT_MISSING",
  "RECORDS_NOT_IN_SKILL",
  "SOURCE_NOT_SYNTHETIC",
  "VIEW_NOT_ALLOWED",
  "REFERENCE_NOT_CONFIGURED",
  "GBD_NOT_IMPORTED",
  "NOT_AUDITED",
]);

const CODE_SENTENCES: Readonly<Record<string, string>> = {
  NO_ROWS: "No readings in this range",
  NO_RHYTHM_DATA: "No rhythm recording for this person",
  NO_PUBLISHED_RANGE: "No published range for this measure",
  ROW_CAP_EXCEEDED: "Too many rows to read at once",
  COHORT_ROW_CAP_EXCEEDED: "Too many cohort rows to read at once",
  COHORT_RECORD_CAP_EXCEEDED: "Too many cohort records to read at once",
  MIXED_UNITS: "The readings are in more than one unit",
  UNIT_MISMATCH: "The units do not match",
  UNSUPPORTED_CONVERSION: "This unit conversion is not supported",
  WINDOW_TOO_SHORT: "The window is too short",
  OUTSIDE_SUBJECT_WINDOW: "Outside the dates this person has records for",
  COHORT_TOO_SMALL: "The cohort is too small to compare with",
  COHORT_NOT_SUPPORTED: "This cohort is not supported",
  DESIGN_NOT_SUPPORTED: "This comparison is not supported",
  SOURCE_NOT_CONNECTED: "That wearable is not linked",
  SUBJECT_SCOPE_VIOLATION: "That person is outside this chat's scope",
  COHORT_TOOLS_OFF: "Cohort tools are off in this chat",
  CARBON_X_NOT_LOCAL: "The DNA model runs only on this machine",
  SIGN_IN: "Sign in to read this",
  LEARNING_CONSENT_WITHDRAWN: "Consent for this was withdrawn",
  LEARNING_CONSENT_SCOPE: "Consent does not cover this",
  LEARNING_CONSENT_MISSING: "No consent was given for this",
  RECORDS_NOT_IN_SKILL: "This skill does not read these records",
  SOURCE_NOT_SYNTHETIC: "Only synthetic data may be read here",
  VIEW_NOT_ALLOWED: "This view is not allowed here",
  VIEW_NOT_FOUND: "No such view in this thread",
  REFERENCE_NOT_CONFIGURED: "The genome reference is not set up",
  GBD_NOT_IMPORTED: "No GBD estimates are imported",
  GBD_NO_ESTIMATE: "No estimate for this place, cause and year",
  GBD_UNKNOWN_CAUSE: "Unknown cause",
  GBD_UNKNOWN_LOCATION: "Unknown place",
  GBD_AMBIGUOUS_LOCATION: "More than one place has this name",
  GBD_TOO_MANY_ROWS: "Too many estimates to read at once",
  NOTHING_TO_MAP: "Nothing to draw on a map",
  DATASET_NOT_FOUND: "No such imported dataset",
  UNKNOWN_MEASURE: "Unknown measure",
  MEASURE_REQUIRED: "No measure was named",
  LOINC_REQUIRED: "No measure code was named",
  SUBJECT_REQUIRED: "No person was named",
  WINDOW_REQUIRED: "No date range was named",
  COMPARE_WINDOW_REQUIRED: "Two date ranges are needed to compare",
  FOCUS_REQUIRED: "No part of the body was named",
  STATES_REQUIRED: "No places were named",
  ESTIMATES_REQUIRED: "No estimates to show",
  OUT_OF_RANGE: "The value is out of range",
  PARTIAL_DATES: "Some dates are incomplete",
  SERIES_NOT_COMBINED: "These series cannot be combined",
  UNKNOWN_COLUMNS: "Unknown columns in the imported table",
  WRONG_DATASET_KIND: "That imported dataset is of another kind",
  NOT_A_VCF_DATASET: "That imported dataset is not a genome file",
  NOT_SAVED: "Nothing is saved for this yet",
  TOO_MANY_VARIANTS: "Too many variants to look up at once",
  MALFORMED_VARIANT_NAMES: "Those variant names could not be read",
  BUILD_UNKNOWN: "The genome build is not known",
  BUILD_MISMATCH: "The genome builds do not match",
  REF_MISMATCH: "The reference base does not match",
  REF_STRAND_MISMATCH: "The reference strand does not match",
  REFERENCE_MISSING: "The genome reference is missing",
  REFERENCE_UNREADABLE: "The genome reference could not be read",
  CARBON_X_FAILED: "The DNA model did not answer",
  GBD_NO_SDI: "No development index for this place",
  GBD_UNKNOWN_RISK: "Unknown risk factor",
  GBD_CSV_UNREADABLE: "The GBD file could not be read",
  GBD_CSV_COLUMNS: "The GBD file has unexpected columns",
  GBD_CSV_ROW: "A row of the GBD file could not be read",
  GBD_CSV_POPULATION_GROUP: "The GBD file mixes population groups",
  GBD_CSV_NAMES_ONLY: "The GBD file has names but no ids",
  GBD_CSV_IDS_ONLY: "The GBD file has ids but no names",
  NO_SUBNATIONAL_BOUNDARIES: "No regional map for this country",
};

/** Tools that read records rather than readings word "no rows" their own way. */
const RECORD_TOOLS: ReadonlySet<string> = new Set([
  "conditions_timeline",
  "medications_timeline",
  "imported_conditions",
  "imported_medications",
]);

export const GENERIC_CODE_SENTENCE = "The tool could not answer this";

/** The plain sentence for a result code; never the code itself. */
export const codeSentence = (tool: string, code: string): string =>
  code === "NO_ROWS" && (RECORD_TOOLS.has(tool) || tool.endsWith("_timeline"))
    ? "No records in this range"
    : (CODE_SENTENCES[code] ?? GENERIC_CODE_SENTENCE);

const refusalCodeOf = (output: unknown): string | null =>
  isRecord(output) &&
  typeof output.code === "string" &&
  /^[A-Z][A-Z0-9_]*$/.test(output.code)
    ? output.code
    : null;

// --- arguments ------------------------------------------------------------------

/** Argument labels in the order a card lists them, with the input keys behind each. */
const ARG_KEYS: readonly Readonly<[label: string, keys: readonly string[]]>[] = [
  [
    "Measure",
    ["loinc", "metric_key", "metric", "measure", "key", "keys", "metrics", "analyte"],
  ],
  ["Kind", ["kind"]],
  ["Source", ["source", "sources"]],
  ["Sport", ["sport"]],
  ["Per", ["per"]],
  ["Variant", ["variant", "variants", "rsid"]],
  ["Window", ["window"]],
  ["Baseline", ["baseline"]],
  ["Target", ["target"]],
  ["Window A", ["window_a"]],
  ["Window B", ["window_b"]],
  ["Subject", ["subject_ref", "subject"]],
  ["Status", ["status"]],
  ["Code", ["code", "exposure_code", "outcome_code"]],
  ["Cohort", ["cohort_id", "cohort"]],
  ["Chart", ["chart", "view", "view_id"]],
  ["Search", ["query", "search"]],
  ["Cause", ["cause"]],
  ["Location", ["location", "location_id", "locations"]],
  ["Year", ["year"]],
  ["Sex", ["sex"]],
  ["Age", ["age"]],
  ["Limit", ["limit"]],
];

const SEARCH_MAX = 80;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

/** A date or timestamp as "1 Oct 2026"; anything else as given. */
const dayText = (value: unknown): string => {
  const text = String(value);
  return ISO_DAY.test(text) ? formatDate(text.slice(0, 10)) : text;
};

const windowValue = (value: unknown): string | null =>
  isRecord(value) && "start" in value && "end" in value
    ? `${dayText(value.start)} – ${dayText(value.end)}`
    : null;

const scalarText = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() === "" ? null : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const items = value.flatMap((item) => {
      const text = scalarText(item);
      return text === null ? [] : [text];
    });
    return items.length === 0 ? null : items.join(", ");
  }
  if (isRecord(value)) {
    const window = windowValue(value);
    if (window !== null) return window;
    const named = value.name ?? value.label ?? value.id;
    return named === undefined ? null : scalarText(named);
  }
  return null;
};

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** The call's named arguments, in the card's order, in words. */
export const toolArgs = (input: unknown): ToolArg[] => {
  if (!isRecord(input)) return [];
  const window =
    "start" in input && "end" in input && !("window" in input)
      ? `${dayText(input.start)} – ${dayText(input.end)}`
      : null;
  return ARG_KEYS.flatMap(([label, keys]) => {
    if (label === "Window" && window !== null) return [{ label, value: window }];
    const key = keys.find((name) => name in input && input[name] !== undefined);
    if (key === undefined) return [];
    const raw = input[key];
    const text =
      label === "Window" ||
      label === "Baseline" ||
      label === "Target" ||
      label.startsWith("Window ")
        ? (windowValue(raw) ?? scalarText(raw))
        : scalarText(raw);
    if (text === null) return [];
    return [{ label, value: label === "Search" ? clip(text, SEARCH_MAX) : text }];
  });
};

// --- measure names --------------------------------------------------------------

const LOINC_CODE = /^\d{1,7}-\d$/;

const TABLE_NAMES: ReadonlyMap<string, string> = new Map(
  Object.values(MEASURES).flatMap((measure) =>
    measure.code === null ? [] : [[measure.code, measure.display] as const],
  ),
);

/** Display names an output gives its codes: `{ loinc, display }` rows and the like. */
export const measureNamesOf = (output: unknown): Record<string, string> => {
  const names: Record<string, string> = {};
  const take = (value: unknown): void => {
    if (!isRecord(value)) return;
    const code = value.loinc ?? value.code;
    const display = value.display ?? value.label ?? value.name;
    if (
      typeof code === "string" &&
      LOINC_CODE.test(code) &&
      typeof display === "string"
    ) {
      names[code] ??= display;
    }
  };
  take(output);
  if (isRecord(output)) {
    for (const key of ["rows", "codes", "measures", "points", "latest"]) {
      const list = output[key];
      if (Array.isArray(list)) list.slice(0, 200).forEach(take);
    }
  }
  return names;
};

/** "Heart rate" becomes "heart rate" mid-sentence; "HbA1c" and "BMI" stay. */
export const midSentence = (name: string): string => {
  const [first = "", ...rest] = name.split(" ");
  const common = /^[A-Z][a-z]+$/.test(first);
  return common ? [first.toLowerCase(), ...rest].join(" ") : name;
};

const measureValues = (card: Pick<ToolCard, "args">): string[] => {
  const measure = card.args.find((arg) => arg.label === "Measure");
  return measure === undefined
    ? []
    : measure.value
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part !== "");
};

/** One code or key in words, or null when nothing names it. */
const nameOf = (
  value: string,
  names: Readonly<Record<string, string>>,
): string | null => {
  if (LOINC_CODE.test(value)) return names[value] ?? TABLE_NAMES.get(value) ?? null;
  if (value.includes(".")) return metricLabel(value);
  return /\d/.test(value) ? null : value;
};

/**
 * The measure of a call in words: "heart rate", "heart rate and one other
 * measure"; `fallback` decides what an unnamed measure reads as ("this
 * measure" on screen, nothing in the export).
 */
export const measureWords = (
  card: Pick<ToolCard, "args">,
  names: Readonly<Record<string, string>>,
  fallback: "this measure" | null = "this measure",
): string | null => {
  const values = measureValues(card);
  if (values.length === 0) return null;
  const named = values.flatMap((value) => {
    const name = nameOf(value, names);
    return name === null ? [] : [midSentence(name)];
  });
  const unnamed = values.length - named.length;
  if (named.length === 0) {
    if (fallback === null) return null;
    return values.length === 1 ? "this measure" : "these measures";
  }
  if (unnamed === 0) return listWords(named);
  return `${listWords(named)} and ${unnamed === 1 ? "one other measure" : `${String(unnamed)} other measures`}`;
};

const listWords = (items: readonly string[]): string =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1] ?? ""}`;

/** Every code's name the answer's calls gave, shared across its cards. */
export const sharedMeasureNames = (
  cards: readonly Pick<ToolCard, "measureNames">[],
): Record<string, string> =>
  cards.reduce<Record<string, string>>(
    (all, card) => ({ ...card.measureNames, ...all }),
    {},
  );

// --- lines ----------------------------------------------------------------------

const GERUNDS: Readonly<Record<string, string>> = {
  Listed: "Listing",
  Checked: "Checking",
  Read: "Reading",
  Summarised: "Summarising",
  Fitted: "Fitting",
  Compared: "Comparing",
  Placed: "Placing",
  Converted: "Converting",
  Showed: "Showing",
  Reopened: "Reopening",
  Summed: "Summing",
  Described: "Describing",
  Counted: "Counting",
  Searched: "Searching",
  Looked: "Looking",
  Assembled: "Assembling",
  Asked: "Asking",
};

/** "Fitted a trend" while it runs: "Fitting a trend". */
export const runningTitle = (title: string): string => {
  const [first = "", ...rest] = title.split(" ");
  const gerund = GERUNDS[first];
  return gerund === undefined ? title : [gerund, ...rest].join(" ");
};

const WINDOW_LABELS = ["Window", "Target", "Window B"] as const;

const windowWords = (card: Pick<ToolCard, "args">): string | null => {
  for (const label of WINDOW_LABELS) {
    const arg = card.args.find((each) => each.label === label);
    if (arg !== undefined) return arg.value.replace(" – ", " to ");
  }
  return null;
};

/** A title whose object is only "a measure" takes the measure's name in its place. */
const GENERIC_OBJECT = / a measure$/;

/**
 * What a step does, in plain words, as the trace lists it: "Fitting a trend
 * of heart rate, 1 Jan 2024 to 31 Dec 2025", "Summarising heart rate". A
 * refusal or an empty result reads its sentence instead.
 */
export const stepLine = (
  card: ToolCard,
  names: Readonly<Record<string, string>> = sharedMeasureNames([card]),
): string => {
  if (card.state === "refused" && card.note !== undefined) return card.note;
  const title = runningTitle(card.title);
  const measure = measureWords(card, { ...names, ...card.measureNames });
  const head =
    measure === null
      ? title
      : GENERIC_OBJECT.test(title)
        ? title.replace(GENERIC_OBJECT, ` ${measure}`)
        : `${title} of ${measure}`;
  return [head, windowWords(card)].filter((part) => part !== null).join(", ");
};

/** "1 row", "12 rows"; null when unknown. */
export const rowCountText = (count: number | null): string | null =>
  count === null ? null : `${String(count)} ${count === 1 ? "row" : "rows"}`;

/** What a card's status badge says. */
export const cardOutcome = (
  card: Pick<ToolCard, "state" | "didNotRun">,
): "Running" | "Done" | "No data" | "Refused" | "Failed" =>
  card.state === "running"
    ? "Running"
    : card.state === "error"
      ? "Failed"
      : card.state === "refused"
        ? card.didNotRun === true
          ? "Refused"
          : "No data"
        : "Done";

/**
 * One line of the export's "Lookups:" list: the title, the measure in words
 * when known, the first four arguments, then the outcome.
 */
export const lookupLine = (
  card: ToolCard,
  names: Readonly<Record<string, string>> = {},
): string => {
  const measure = measureWords(card, { ...names, ...card.measureNames }, null);
  const head = measure === null ? card.title : `${card.title}: ${measure}`;
  const args = card.args
    .slice(0, 4)
    .map((arg) => `${arg.label.toLowerCase()} ${arg.value}`)
    .join(", ");
  const outcome =
    card.state === "refused"
      ? `${card.didNotRun === true ? "refused" : "no data"}: ${card.note ?? GENERIC_CODE_SENTENCE}`
      : card.rowCount === null
        ? card.state
        : (rowCountText(card.rowCount) ?? card.state);
  return `- ${head}${args === "" ? "" : ` (${args})`} · ${outcome}`;
};

// --- building cards -------------------------------------------------------------

const ROW_KEYS = ["rows", "subjects", "codes", "points", "views", "records", "variants"];

const countOf = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;

const countIn = (value: unknown): number | null =>
  isRecord(value) ? countOf(value.n) : null;

const pairCount = (a: unknown, b: unknown): number | null => {
  const first = countIn(a);
  const second = countIn(b);
  return first === null || second === null ? null : first + second;
};

/**
 * Rows a finished call read, from its output, by the rules the query tools
 * count their audit rows with: a list of rows, or a summary's own count
 * (`n`, `n_observations`, `rows_read`, two windows' `n`, each measure's
 * `n`). Null when the output names none.
 */
export const rowCountOfOutput = (output: unknown): number | null => {
  if (Array.isArray(output)) return output.length;
  if (!isRecord(output)) return null;
  for (const key of ["rows", "subjects"]) {
    const list = output[key];
    if (Array.isArray(list)) return list.length;
  }
  const counted =
    countOf(output.n_observations) ??
    countOf(output.rows_read) ??
    countOf(output.n) ??
    pairCount(output.baseline, output.target) ??
    pairCount(output.window_a, output.window_b);
  if (counted !== null) return counted;
  const measures = output.measures;
  if (
    Array.isArray(measures) &&
    measures.length > 0 &&
    measures.every((m) => countIn(m) !== null)
  ) {
    return measures.reduce<number>(
      (total, measure) => total + (countIn(measure) ?? 0),
      0,
    );
  }
  for (const key of ROW_KEYS) {
    const list = output[key];
    if (Array.isArray(list)) return list.length;
  }
  return null;
};

/**
 * One card from one tool part. `auditRows` is the saved answer's audit row
 * count for the call (it wins over a count read from the output); undefined
 * while streaming, null when no audit row matched.
 */
export const toolCardOf = (
  part: ToolPartLike,
  auditRows?: number | null,
): ToolCard | null => {
  const tool = toolNameOf(part);
  if (tool === null) return null;
  const base = {
    id: part.toolCallId,
    tool,
    title: toolTitle(tool),
    args: toolArgs(part.input),
  };
  if (part.state === "output-error") return { ...base, state: "error", rowCount: null };
  if (part.state !== "output-available")
    return { ...base, state: "running", rowCount: null };
  const names = measureNamesOf(part.output);
  const withNames = Object.keys(names).length === 0 ? {} : { measureNames: names };
  const code = refusalCodeOf(part.output);
  if (code !== null) {
    const didNotRun = auditRows === undefined ? GATE_CODES.has(code) : auditRows === null;
    return {
      ...base,
      ...withNames,
      state: "refused",
      rowCount: didNotRun ? null : 0,
      note: codeSentence(tool, code),
      code,
      ...(didNotRun ? { didNotRun: true as const } : {}),
    };
  }
  return {
    ...base,
    ...withNames,
    state: "done",
    rowCount: auditRows ?? rowCountOfOutput(part.output),
  };
};

/** Every tool part of a message as cards, in order. */
export const toolCardsOf = (
  parts: readonly Readonly<{ type: string }>[],
  auditRows: ReadonlyMap<string, number | null> = new Map(),
): ToolCard[] =>
  parts.flatMap((part) => {
    if (!("toolCallId" in part)) return [];
    const toolPart = part as ToolPartLike;
    const card = toolCardOf(
      toolPart,
      auditRows.has(toolPart.toolCallId) ? auditRows.get(toolPart.toolCallId) : undefined,
    );
    return card === null ? [] : [card];
  });

/** Stored parts replayed as the live stream's parts: call id = step number. */
export const storedAsLiveParts = (stored: readonly StoredToolPart[]): ToolPartLike[] =>
  stored.map((part) => ({
    type: `${TOOL_PREFIX}${part.tool}`,
    toolCallId: String(part.seq),
    state: "output-available",
    input: part.input,
    output: part.output,
  }));

/** A saved answer's cards, each with its stored audit row count. */
export const storedToolCards = (stored: readonly StoredToolPart[]): ToolCard[] =>
  toolCardsOf(
    storedAsLiveParts(stored),
    new Map(stored.map((part) => [String(part.seq), part.rowCount])),
  );
