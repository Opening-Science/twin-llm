import { DNA_ASK_TOOL, GENOME_REPORT_TOOL } from "@/packages/carbon-x/constants";
import { GBD_ESTIMATE_TOOL, GBD_PROFILE_TOOL } from "@/packages/gbd-local/constants";
import { GBD_MODEL_TOOL } from "@/packages/gbd-mcp/constants";
import { GUIDELINE_MODEL_TOOL } from "@/packages/guidelines/constants";
import { KNOWLEDGE_MODEL_TOOL } from "@/packages/knowledge/constants";
import {
  IMPORTED_CONDITIONS_TOOL,
  GENOME_VARIANTS_TOOL,
  IMPORTED_DATASETS_TOOL,
  IMPORTED_LATEST_TOOL,
  IMPORTED_MEDICATIONS_TOOL,
  IMPORTED_TABLE_TOOL,
  IMPORTED_TREND_TOOL,
} from "@/packages/query-tools/imported-names";

/**
 * A chat tool in plain words, both tenses in one entry so they cannot drift
 * (#503). `done` titles a step the answer took ("Checked data coverage");
 * `does` says what the tool does before it runs ("checks data coverage"), as
 * the `/` palette, a skill's page and an agent's page list it (#480). A person
 * never reads a model-facing tool id. Shared here because the chat, commands,
 * customize and agents all need it.
 */
export type ToolWords = { readonly done: string; readonly does: string };

const TITLES: Readonly<Record<string, ToolWords>> = {
  list_subjects: { done: "Listed cohort subjects", does: "lists cohort subjects" },
  subject_window: {
    done: "Checked a subject's date range",
    does: "checks a subject's date range",
  },
  observations_for_subject: { done: "Read observations", does: "reads observations" },
  latest_by_loinc: { done: "Read latest values", does: "reads latest values" },
  summary_stats: { done: "Summarised a measure", does: "summarises a measure" },
  trend: { done: "Fitted a trend", does: "fits a trend" },
  baseline_deviation: {
    done: "Compared with a baseline",
    does: "compares with a baseline",
  },
  coverage: { done: "Checked data coverage", does: "checks data coverage" },
  compare_windows: { done: "Compared two windows", does: "compares two windows" },
  range_position: {
    done: "Placed a value against its published range",
    does: "places a value against its published range",
  },
  convert_unit: { done: "Converted a unit", does: "converts a unit" },
  cohort_position: {
    done: "Placed a value among the synthetic cohort",
    does: "places a value among the synthetic cohort",
  },
  conditions_timeline: {
    done: "Listed recorded conditions",
    does: "lists recorded conditions",
  },
  medications_timeline: {
    done: "Listed recorded medication requests",
    does: "lists recorded medication requests",
  },
  values_around_event: {
    done: "Compared values before and after an event",
    does: "compares values before and after an event",
  },
  show_view: { done: "Showed a view", does: "shows a view" },
  list_views: { done: "Listed this thread's views", does: "lists this thread's views" },
  open_view: { done: "Reopened a view", does: "reopens a view" },
  sleep_summary: {
    done: "Summarised sleep per night",
    does: "summarises sleep per night",
  },
  hrv_trend: { done: "Fitted an HRV trend", does: "fits an HRV trend" },
  resting_hr_trend: {
    done: "Fitted a resting heart rate trend",
    does: "fits a resting heart rate trend",
  },
  training_load: { done: "Summed workout minutes", does: "sums workout minutes" },
  cross_source_compare: {
    done: "Compared two wearables",
    does: "compares two wearables",
  },
  rhythm_irregularity: {
    done: "Described a simulated heart rhythm recording",
    does: "describes a simulated heart rhythm recording",
  },
  cohort_event_rates: {
    done: "Counted event rates in a synthetic cohort",
    does: "counts event rates in a synthetic cohort",
  },
  [GUIDELINE_MODEL_TOOL]: { done: "Searched guidelines", does: "searches guidelines" },
  [GBD_MODEL_TOOL]: {
    done: "Looked up population data",
    does: "looks up population data",
  },
  [GBD_ESTIMATE_TOOL]: {
    done: "Looked up imported GBD estimates",
    does: "looks up imported GBD estimates",
  },
  [GBD_PROFILE_TOOL]: {
    done: "Assembled a GBD profile from imported estimates",
    does: "assembles a GBD profile from imported estimates",
  },
  [KNOWLEDGE_MODEL_TOOL]: {
    done: "Searched TwinLLM notes",
    does: "searches TwinLLM notes",
  },
  [GENOME_REPORT_TOOL]: {
    done: "Read the released genome report",
    does: "reads the released genome report",
  },
  [DNA_ASK_TOOL]: {
    done: "Asked Carbon-X (research model) about a variant",
    does: "asks Carbon-X (research model) about a variant",
  },
  [GENOME_VARIANTS_TOOL]: {
    done: "Looked up named variants in your imported genome file",
    does: "looks up named variants in your imported genome file",
  },
  [IMPORTED_DATASETS_TOOL]: {
    done: "Listed your imported datasets",
    does: "lists your imported datasets",
  },
  [IMPORTED_LATEST_TOOL]: {
    done: "Read your newest imported readings",
    does: "reads your newest imported readings",
  },
  [IMPORTED_TREND_TOOL]: {
    done: "Fitted a trend of one imported series",
    does: "fits a trend of one imported series",
  },
  [IMPORTED_TABLE_TOOL]: {
    done: "Read columns of your imported table",
    does: "reads columns of your imported table",
  },
  [IMPORTED_CONDITIONS_TOOL]: {
    done: "Listed conditions in your imported records",
    does: "lists conditions in your imported records",
  },
  [IMPORTED_MEDICATIONS_TOOL]: {
    done: "Listed medication requests in your imported records",
    does: "lists medication requests in your imported records",
  },
};

/** Both tenses of a tool with written words; undefined for an unknown id. */
export const toolWords = (tool: string): ToolWords | undefined =>
  Object.hasOwn(TITLES, tool) ? TITLES[tool] : undefined;

const spelledOut = (tool: string): string => tool.replace(/[_.-]+/g, " ").trim();

/** The step title of a call the answer made; an unknown id is spelled out as words, never shown raw. */
export const toolTitle = (tool: string): string => {
  const known = toolWords(tool);
  if (known) return known.done;
  const words = spelledOut(tool);
  return words === "" ? "Tool call" : words.charAt(0).toUpperCase() + words.slice(1);
};

/** What the tool does, said before it runs ("checks data coverage"); an unknown id is spelled out. */
export const toolDoes = (tool: string): string =>
  toolWords(tool)?.does ?? (spelledOut(tool).toLowerCase() || "a tool");

/** True when the tool has written words in both tenses, not the spelled-out fallback. */
export const hasToolTitle = (tool: string): boolean => Object.hasOwn(TITLES, tool);

/** Every tool id with written words. */
export const TOOLS_IN_WORDS: readonly string[] = Object.keys(TITLES);
