import "server-only";

import type { DataMode } from "@/infrastructure/data-mode-policy";
import { SHOW_VIEW_TOOL } from "@/infrastructure/chat-view";
import { formatForPrompt } from "@/infrastructure/format-measure";
import type { GoogleHealthSummary } from "@/infrastructure/google-health-types";
import { offeredSummaries } from "@/infrastructure/offered-keys";
import type { TurnSkill } from "@/infrastructure/skill-gate";
import type { OuraSummary } from "@/infrastructure/oura-types";
import type { VitronicSummary } from "@/infrastructure/vitronic-types";
import type { WhoopSummary } from "@/infrastructure/whoop-types";
import {
  CARBON_X_LABEL,
  DNA_ASK_TOOL,
  GENOME_REPORT_TOOL,
} from "@/packages/carbon-x/constants";
import { GBD_MODEL_TOOL } from "@/packages/gbd-mcp/constants";
import { GUIDELINE_MODEL_TOOL } from "@/packages/guidelines/constants";
import { KNOWLEDGE_MODEL_TOOL } from "@/packages/knowledge/constants";
import type { TOOL_DEFINITIONS } from "@/packages/query-tools/schemas";

/**
 * Twin LLM system prompt: personalized-medicine research assistant with
 * mandatory structured chain-of-thought and evidence attribution.
 *
 * This is explainability *scaffolding* for research — models cite injected
 * wearable metrics by key. It is not causal/SHAP-style feature attribution.
 */
type WearableSummary = OuraSummary | WhoopSummary | GoogleHealthSummary | VitronicSummary;

/**
 * Prints an already-offered summary; the cap and filter live in `offeredSummaries`.
 * Values go through `formatForPrompt`, so the model sees the same precision and
 * unit the UI shows rather than whatever the source stored.
 */
const keyList = (summary: WearableSummary | null): string => {
  if (!summary || summary.metrics.length === 0) return "(none)";
  return summary.metrics.map((metric) => `- ${formatForPrompt(metric)}`).join("\n");
};

type QueryToolName = (typeof TOOL_DEFINITIONS)[number]["name"];

/** Typed so a renamed query tool fails typecheck instead of leaving a stale name in the prompt. */
const queryTool = (name: QueryToolName): string => `\`${name}\``;

/** The cohort fetch tools, in the order the prompt names them. */
const FETCH_TOOLS: readonly QueryToolName[] = [
  "latest_by_loinc",
  "observations_for_subject",
  "subject_window",
  "summary_stats",
];

/** "a, b and c", as the prompt has always written the fetch tools. */
const andList = (items: readonly string[]): string =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1) ?? ""}`;

const REFERENCE_TOOL_LINES: readonly Readonly<{ tool: string; text: string }>[] = [
  {
    tool: GBD_MODEL_TOOL,
    text: `\`${GBD_MODEL_TOOL}\` gives population figures from GBD`,
  },
  {
    tool: GUIDELINE_MODEL_TOOL,
    text: `\`${GUIDELINE_MODEL_TOOL}\` gives guideline passages`,
  },
  {
    tool: KNOWLEDGE_MODEL_TOOL,
    text: `\`${KNOWLEDGE_MODEL_TOOL}\` explains TwinLLM's own metrics, units, data sources and limits`,
  },
];

/**
 * Only in synthetic mode: the model gets the query tools on every request, and
 * this tells it what they read and how to cite them. Personal mode adds nothing,
 * so its prompt stays exactly as it was.
 *
 * `offered` says which tools this request carries. A user can turn sources off
 * at /start, and the prompt must not name a tool the model cannot call.
 * With every tool offered, the text is the same as before.
 */
const syntheticCohortSection = (
  mode: DataMode,
  offered: (tool: string) => boolean,
): readonly string[] => {
  if (mode !== "synthetic") return [];
  const references = REFERENCE_TOOL_LINES.filter((line) => offered(line.tool));
  const fetchTools = FETCH_TOOLS.filter(offered);
  const cohortOn = offered("list_subjects") || fetchTools.length > 0;
  return [
    "## Data mode: synthetic research cohort",
    "This session reads a synthetic research cohort generated with Synthea. The rows describe no real person.",
    ...(cohortOn
      ? [
          offered("list_subjects")
            ? `- Call ${queryTool("list_subjects")} to get \`subject_ref\` values. Never invent one.`
            : "- Use the `subject_ref` the question names. Never invent one.",
          ...(fetchTools.length > 0
            ? [
                `- Fetch rows with ${andList(fetchTools.map(queryTool))}. Observations use LOINC codes and UCUM units.`,
              ]
            : []),
        ]
      : [
          "- The cohort record tools are turned off for this user. If a question needs cohort rows, say so under Uncertainty and do not guess values.",
        ]),
    ...(references.length > 0
      ? [`- ${references.map((line) => line.text).join("; ")}.`]
      : []),
    "- Cite tool results in Reasoning by tool, subject_ref, LOINC and date; they are recorded in tool_calls. Tool rows are not wearable keys, so they do not go under Evidence Used.",
    "- When a tool returns no rows or refuses a subject, say so plainly and do not guess values.",
    "",
  ];
};

/**
 * The skill the person ran, after everything else so its instructions are
 * the last word on what to do. Its tools are already the only ones offered.
 */
const skillSection = (skill: TurnSkill | null): readonly string[] =>
  skill === null
    ? []
    : [
        "",
        `## Skill: /${skill.name}`,
        `The person ran /${skill.name}: ${skill.description}`,
        "Follow these instructions for this turn. They do not change the headings above.",
        "",
        skill.instructions,
      ];

/** One line on charts, when this request carries `show_view`. */
const viewSection = (offered: (tool: string) => boolean): readonly string[] =>
  offered(SHOW_VIEW_TOOL)
    ? [
        "## Charts",
        `To show a measure over time, call \`${SHOW_VIEW_TOOL}\` with kind \`chart.timeseries\`, a measure (a LOINC code with subject, or a wearable key without its date, such as sleep.score) and a window. The server draws it from its own rows; do not list the points yourself.`,
        "",
      ]
    : [];

/**
 * Only when this request carries the genome tools, which only a personal turn
 * on a fully local setup ever does. Absent `offeredTools` means none here:
 * the genome tools are never assumed.
 */
const genomeSection = (
  offeredTools: ReadonlySet<string> | undefined,
): readonly string[] =>
  offeredTools?.has(DNA_ASK_TOOL)
    ? [
        "## Genome (released Ark report)",
        `- \`${GENOME_REPORT_TOOL}\` reads the rsid-genotypes report the person released from their Ark. \`${DNA_ASK_TOOL}\` asks ${CARBON_X_LABEL} about one rsID from it; give only the rsID.`,
        `- Quote a ${CARBON_X_LABEL} answer as that model's, labelled with its name. It is research output, not a fact about the person.`,
        "- Describe what a variant is known to affect. Never give a dose, and never say to start, stop or change a medicine.",
        "- `no call` means the call file has nothing there; it is not the reference allele.",
        "",
      ]
    : [];

export const buildTwinSystemPrompt = (params: {
  readonly mode: DataMode;
  readonly oura: OuraSummary | null;
  readonly whoop: WhoopSummary | null;
  readonly googleHealth: GoogleHealthSummary | null;
  readonly vitronic: VitronicSummary | null;
  /** Tool names this request carries; left out, every tool is assumed. */
  readonly offeredTools?: ReadonlySet<string>;
  /** The skill this turn runs under, if any. */
  readonly skill?: TurnSkill | null;
}): string => {
  const hasAny = Boolean(
    params.oura || params.whoop || params.googleHealth || params.vitronic,
  );
  const offered = offeredSummaries(params);

  const ouraBlock = params.oura
    ? [
        "## Wearable context (Oura)",
        params.oura.narrative,
        "",
        "### Available Oura keys (copy exactly into Evidence Used)",
        keyList(offered.oura),
      ].join("\n")
    : [
        "## Wearable context (Oura)",
        "No Oura snapshot is linked for this user yet.",
      ].join("\n");

  const whoopBlock = params.whoop
    ? [
        "## Wearable context (Whoop)",
        params.whoop.narrative,
        "",
        "### Available Whoop keys (copy exactly into Evidence Used)",
        keyList(offered.whoop),
      ].join("\n")
    : [
        "## Wearable context (Whoop)",
        "No Whoop snapshot is linked for this user yet.",
      ].join("\n");

  const googleHealthBlock = params.googleHealth
    ? [
        "## Wearable context (Google Health / Fitbit)",
        params.googleHealth.narrative,
        "",
        "### Available Google Health keys (copy exactly into Evidence Used)",
        keyList(offered.googleHealth),
      ].join("\n")
    : [
        "## Wearable context (Google Health / Fitbit)",
        "No Google Health snapshot is linked for this user yet.",
      ].join("\n");

  const vitronicForChat = offered.vitronic;
  const vitronicBlock = vitronicForChat
    ? [
        "## Wearable context (BodyLoop)",
        vitronicForChat.narrative,
        "",
        "### Available BodyLoop keys (copy exactly into Evidence Used)",
        keyList(vitronicForChat),
      ].join("\n")
    : [
        "## Wearable context (BodyLoop)",
        "No BodyLoop snapshot is linked for this user yet.",
      ].join("\n");

  return [
    "You are TwinLLM, a research assistant for personalized-medicine questions.",
    "You are NOT a doctor. Do not diagnose or prescribe. Include uncertainty clearly.",
    "If asked to diagnose, to pick a dose, or to start, stop or change a medicine, start your reply with REFUSE: and one plain sentence instead of the headings below.",
    "Always structure your reply with these exact markdown headings, in order:",
    "",
    "## Reasoning",
    "Step-by-step chain of thought. Be concise but explicit about assumptions.",
    "",
    "## Evidence Used",
    "Bullet list of wearable metric keys you relied on. Each line MUST be exactly:",
    "- [exact.key.from.list]",
    "Use only keys from the Available keys sections below. Example:",
    "- [sleep.hr.2026-09-07]",
    "- [sleep.hrv.2026-09-07]",
    "If you used no wearable metric, write a single bullet:",
    "- none",
    "",
    "## Answer",
    "The user-facing answer in plain language. Do not invent wearable numbers.",
    "",
    "## Uncertainty",
    "What is unknown, what would change the conclusion, and research caveats.",
    "",
    ...viewSection((tool) => params.offeredTools?.has(tool) ?? true),
    ...genomeSection(params.offeredTools),
    ...syntheticCohortSection(
      params.mode,
      (tool) => params.offeredTools?.has(tool) ?? true,
    ),
    ouraBlock,
    "",
    whoopBlock,
    "",
    googleHealthBlock,
    "",
    vitronicBlock,
    hasAny
      ? "If a question needs a metric you do not have in Available keys, say so under Uncertainty."
      : "Under Evidence Used write `- none` until a wearable is connected and synced.",
    ...skillSection(params.skill ?? null),
  ].join("\n");
};
