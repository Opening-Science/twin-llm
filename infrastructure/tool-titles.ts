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
 * A chat tool in plain words. The answer column titles each call with it, and
 * the `/` palette, a skill's page and an agent's page list a skill's tools
 * with the same words (#480), so a person never reads a model-facing tool id.
 * Shared here because the arena, commands, customize and agents all need it.
 */

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
  range_position: "Placed a value against its published range",
  convert_unit: "Converted a unit",
  cohort_position: "Placed a value among the synthetic cohort",
  conditions_timeline: "Listed recorded conditions",
  medications_timeline: "Listed recorded medication requests",
  values_around_event: "Compared values before and after an event",
  show_view: "Showed a view",
  list_views: "Listed this thread's views",
  open_view: "Reopened a view",
  sleep_summary: "Summarised sleep per night",
  hrv_trend: "Fitted an HRV trend",
  resting_hr_trend: "Fitted a resting heart rate trend",
  training_load: "Summed workout minutes",
  cross_source_compare: "Compared two wearables",
  rhythm_irregularity: "Described a simulated heart rhythm recording",
  cohort_event_rates: "Counted event rates in a synthetic cohort",
  [GUIDELINE_MODEL_TOOL]: "Searched guidelines",
  [GBD_MODEL_TOOL]: "Looked up population data",
  [GBD_ESTIMATE_TOOL]: "Looked up imported GBD estimates",
  [GBD_PROFILE_TOOL]: "Assembled a GBD profile from imported estimates",
  [KNOWLEDGE_MODEL_TOOL]: "Searched TwinLLM notes",
  [GENOME_REPORT_TOOL]: "Read the released genome report",
  [DNA_ASK_TOOL]: "Asked Carbon-X (research model) about a variant",
  [GENOME_VARIANTS_TOOL]: "Looked up named variants in your imported genome file",
  [IMPORTED_DATASETS_TOOL]: "Listed your imported datasets",
  [IMPORTED_LATEST_TOOL]: "Read your newest imported readings",
  [IMPORTED_TREND_TOOL]: "Fitted a trend of one imported series",
  [IMPORTED_TABLE_TOOL]: "Read columns of your imported table",
  [IMPORTED_CONDITIONS_TOOL]: "Listed conditions in your imported records",
  [IMPORTED_MEDICATIONS_TOOL]: "Listed medication requests in your imported records",
};

/** The tool's plain title; an unknown id is spelled out as words, never shown raw. */
export const toolTitle = (tool: string): string => {
  const known = TITLES[tool];
  if (known) return known;
  const words = tool.replace(/[_.-]+/g, " ").trim();
  return words === "" ? "Tool call" : words.charAt(0).toUpperCase() + words.slice(1);
};

/** True when the tool has a written title, not the spelled-out fallback. */
export const hasToolTitle = (tool: string): boolean => tool in TITLES;
