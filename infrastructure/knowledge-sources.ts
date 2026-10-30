import { DNA_ASK_TOOL, GENOME_REPORT_TOOL } from "@/packages/carbon-x/constants";
import { GBD_MODEL_TOOL } from "@/packages/gbd-mcp/constants";
import { GUIDELINE_MODEL_TOOL } from "@/packages/guidelines/constants";
import { KNOWLEDGE_MODEL_TOOL } from "@/packages/knowledge/constants";
import { IMPORTED_TOOLS } from "@/packages/query-tools/imported-names";
import type { TOOL_DEFINITIONS } from "@/packages/query-tools/schemas";

type QueryToolName = (typeof TOOL_DEFINITIONS)[number]["name"];

/**
 * The knowledge sources chat can reach today, and the chat tools behind each.
 *
 * It lives here rather than in a feature because two features need the same
 * list: onboarding shows it as toggles, and chat drops the tools of every
 * source a user turned off. Pure, so the client and the server share it.
 *
 * Preferences are stored as the *disabled* ids, so a source added later starts
 * on for everyone, and an id that no longer exists is dropped on read.
 */

export const KNOWLEDGE_SOURCE_IDS = [
  "guidelines",
  "opentwin-knowledge",
  "cohort-records",
  "cohort-analytics",
  "wearable-analytics",
  "gbd",
  "ark-genome",
  "imported-data",
] as const;

export type KnowledgeSourceId = (typeof KNOWLEDGE_SOURCE_IDS)[number];

export type KnowledgeSource = Readonly<{
  id: KnowledgeSourceId;
  label: string;
  description: string;
  /** Chat tool names this source owns. */
  tools: readonly string[];
  /**
   * A source whose tools only work with another one on. Turning the other off
   * turns this off too, and turning this on turns the other on.
   */
  requires?: KnowledgeSourceId;
}>;

export type KnowledgeSourceGroup = Readonly<{
  id: string;
  label: string;
  description: string;
  sources: readonly KnowledgeSource[];
}>;

export const COHORT_RECORD_TOOLS = [
  "list_subjects",
  "subject_window",
  "observations_for_subject",
  "latest_by_loinc",
  "summary_stats",
  "conditions_timeline",
  "medications_timeline",
] as const satisfies readonly QueryToolName[];

export const COHORT_ANALYTICS_TOOLS = [
  "trend",
  "baseline_deviation",
  "coverage",
  "compare_windows",
  "range_position",
  "convert_unit",
  "cohort_position",
  "rhythm_irregularity",
  "values_around_event",
] as const satisfies readonly QueryToolName[];

/** Wearable summaries: the linked snapshots in personal mode, a synthetic subject's series otherwise. */
export const WEARABLE_ANALYTICS_TOOLS = [
  "sleep_summary",
  "hrv_trend",
  "resting_hr_trend",
  "training_load",
  "cross_source_compare",
] as const satisfies readonly QueryToolName[];

export const KNOWLEDGE_SOURCE_GROUPS: readonly KnowledgeSourceGroup[] = [
  {
    id: "reference",
    label: "Reference reading",
    description: "Passages searched on this machine and cited in the answer.",
    sources: [
      {
        id: "guidelines",
        label: "Clinical guideline passages",
        description: "Published guideline text indexed locally, cited as reference.",
        tools: [GUIDELINE_MODEL_TOOL],
      },
      {
        id: "opentwin-knowledge",
        label: "OpenTwin knowledge notes",
        description: "What each wearable metric measures, its units, codes and limits.",
        tools: [KNOWLEDGE_MODEL_TOOL],
      },
    ],
  },
  {
    id: "cohort",
    label: "Synthetic cohort",
    description: "Closed tools over the Synthea demo cohort. No real person.",
    sources: [
      {
        id: "cohort-records",
        label: "Subjects and observations",
        description:
          "List subjects and read their coded observations, recorded conditions and medication requests.",
        tools: COHORT_RECORD_TOOLS,
      },
      {
        id: "cohort-analytics",
        label: "Trends and baselines",
        description:
          "Trend, baseline deviation, coverage, window comparisons, position against the Anchor v3 published range, unit conversions, a percentile in the synthetic cohort and irregularity metrics of simulated heart rhythm recordings. Needs Subjects and observations on.",
        tools: COHORT_ANALYTICS_TOOLS,
        requires: "cohort-records",
      },
    ],
  },
  {
    id: "wearables",
    label: "Wearables",
    description: "Computed on this server from wearable data, read where it is kept.",
    sources: [
      {
        id: "wearable-analytics",
        label: "Sleep, HRV, resting heart rate and workouts",
        description:
          "Nightly sleep, HRV and resting heart rate trends, and workout minutes, per source, from linked Oura, Whoop and Google Health data. In synthetic mode, a synthetic subject's synthetic series.",
        tools: WEARABLE_ANALYTICS_TOOLS,
      },
    ],
  },
  {
    id: "population",
    label: "Population data",
    description: "Population figures, never a statement about one person.",
    sources: [
      {
        id: "gbd",
        label: "IHME GBD estimates",
        description: "Population estimates from the Global Burden of Disease study.",
        tools: [GBD_MODEL_TOOL],
      },
    ],
  },
  {
    id: "genome",
    label: "Your genome",
    description: "Personal data mode on this machine only. Never sent to a hosted model.",
    sources: [
      {
        id: "ark-genome",
        label: "Released Ark report and Carbon-X",
        description:
          "The rsid-genotypes report you released from your Ark, and the local Carbon-X research model for one variant at a time.",
        tools: [GENOME_REPORT_TOOL, DNA_ASK_TOOL],
      },
    ],
  },
  {
    id: "imports",
    label: "Your imported data",
    description: "Personal data mode on this machine only. Never sent to a hosted model.",
    sources: [
      {
        id: "imported-data",
        label: "Imported records and wearable exports",
        description:
          "Datasets you imported on Customize · Data: the newest reading per code, a trend of one series, chosen table columns and recorded conditions, read by a local model.",
        tools: IMPORTED_TOOLS,
      },
    ],
  },
];

export const ALL_KNOWLEDGE_SOURCES: readonly KnowledgeSource[] =
  KNOWLEDGE_SOURCE_GROUPS.flatMap((group) => group.sources);

export const isKnowledgeSourceId = (value: unknown): value is KnowledgeSourceId =>
  typeof value === "string" &&
  (KNOWLEDGE_SOURCE_IDS as readonly string[]).includes(value);

/**
 * Stored ids, cleaned: unknown values and duplicates go, order follows the
 * catalogue, and a source whose required source is off is off as well.
 */
export const normaliseDisabledSources = (raw: unknown): readonly KnowledgeSourceId[] => {
  if (!Array.isArray(raw)) return [];
  const wanted = new Set(raw.filter(isKnowledgeSourceId));
  return KNOWLEDGE_SOURCE_IDS.filter(
    (id) => wanted.has(id) || isRequirementOff(id, wanted),
  );
};

const isRequirementOff = (
  id: KnowledgeSourceId,
  disabled: ReadonlySet<KnowledgeSourceId>,
): boolean => {
  const required = ALL_KNOWLEDGE_SOURCES.find((source) => source.id === id)?.requires;
  return required !== undefined && disabled.has(required);
};

/** Every chat tool name owned by a disabled source, dependents included. */
export const disabledToolNames = (
  disabled: readonly KnowledgeSourceId[],
): ReadonlySet<string> => {
  const off = normaliseDisabledSources(disabled);
  return new Set(
    ALL_KNOWLEDGE_SOURCES.filter((source) => off.includes(source.id)).flatMap(
      (source) => source.tools,
    ),
  );
};

/**
 * The tool set without the tools of disabled sources. Tools no source owns
 * are kept: this only ever takes away what a user switched off.
 */
export const withoutDisabledTools = <V>(
  tools: Readonly<Record<string, V>>,
  disabled: readonly KnowledgeSourceId[],
): Record<string, V> => {
  const drop = disabledToolNames(disabled);
  return Object.fromEntries(Object.entries(tools).filter(([name]) => !drop.has(name)));
};

/** "2 of 2 on", counted over the sources that can be used on this server. */
export const groupOnCount = (
  group: KnowledgeSourceGroup,
  disabled: readonly KnowledgeSourceId[],
  available: (id: KnowledgeSourceId) => boolean,
): Readonly<{ on: number; total: number }> => {
  const usable = group.sources.filter((source) => available(source.id));
  return {
    on: usable.filter((source) => !disabled.includes(source.id)).length,
    total: usable.length,
  };
};

/** Turns one source on or off; turning one on also turns on what it requires. */
export const setSourceEnabled = (
  disabled: readonly KnowledgeSourceId[],
  id: KnowledgeSourceId,
  enabled: boolean,
): readonly KnowledgeSourceId[] => {
  if (!enabled) return normaliseDisabledSources([...disabled, id]);
  const required = ALL_KNOWLEDGE_SOURCES.find((source) => source.id === id)?.requires;
  return normaliseDisabledSources(
    disabled.filter((item) => item !== id && item !== required),
  );
};

/** Turns every usable source of a group on or off; unusable ones keep their setting. */
export const setGroupEnabled = (
  disabled: readonly KnowledgeSourceId[],
  group: KnowledgeSourceGroup,
  enabled: boolean,
  available: (id: KnowledgeSourceId) => boolean,
): readonly KnowledgeSourceId[] =>
  normaliseDisabledSources(
    group.sources
      .filter((source) => available(source.id))
      .reduce(
        (current, source) => setSourceEnabled(current, source.id, enabled),
        disabled,
      ),
  );
