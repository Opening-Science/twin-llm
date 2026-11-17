/**
 * What the model sees for a W1 item under each context condition of the
 * source-attribution study (P6 section 5, #508). Pure.
 *
 * - `C0` keys only: each reading as the stored key, its label and value, as
 *   the prompt listed them before #464. WHOOP and Google Health keys carry
 *   a vendor prefix; Oura keys carry none.
 * - `C1` provenance labels: C0's line plus the source's name and the day,
 *   and the selection rule in words.
 * - `C2` C1 plus, per source and measure, the accuracy review's one-sentence
 *   note and its evidence level (`features/wearables/accuracy`). Google
 *   Health may hold readings from a Fitbit or a Pixel Watch; its note says
 *   the device is not known and gives both, at the lower level.
 *
 * Readings are listed source by source in the item's `listing` order, which
 * was drawn apart from the rule, so "took the first source listed" and
 * "followed the rule" differ on about half the multi-source items.
 *
 * The prompt's headings and Evidence Used rules are the chat's, so
 * `parseTwinAnswer` reads the answer as the app would.
 */
import { formatDate, formatForPrompt } from "../../../infrastructure/format-measure";
import { SECTION_GUIDANCE } from "../../../infrastructure/twin-section-guidance";
import {
  WEARABLE_SOURCE_LABEL,
  type WearableSourceId,
} from "../../../infrastructure/wearable-provenance";
import {
  MEASURE_LABEL,
  SOURCE_TOLERANCE,
  type SourceMeasure,
} from "../../../infrastructure/wearable-source-rules";
import { ACCURACY_NOTES } from "../../../features/wearables/accuracy/accuracy-notes";
import type {
  AccuracyDevice,
  AccuracyMeasure,
  EvidenceLevel,
} from "../../../features/wearables/accuracy/types";
import type { SelectionRule, W1Item, W1Metric } from "../../synthetic-wearables/w1-items";

export const CONDITIONS = ["C0", "C1", "C2"] as const;
export type Condition = (typeof CONDITIONS)[number];

export type StudyPrompt = Readonly<{ system: string; user: string }>;

const sourceList = (order: readonly WearableSourceId[]): string =>
  order.map((source) => WEARABLE_SOURCE_LABEL[source]).join(", ");

const toleranceText = (measure: SourceMeasure): string => {
  const { absolute, relative, unit } = SOURCE_TOLERANCE[measure];
  return relative > 0
    ? `${absolute} ${unit} or ${Math.round(relative * 100)}% of the higher reading, whichever is larger`
    : `${absolute} ${unit}`;
};

/** The selection rule as the system prompt states it. */
export const ruleText = (
  rule: SelectionRule,
  order: readonly WearableSourceId[],
  measure: SourceMeasure | null,
): string => {
  const fixed = `When more than one source has a reading for the same measure and day, use the reading of the first source in this order: ${sourceList(order)}. Say which source you used, which other sources also had a reading, and that this fixed order decided.`;
  if (rule === "fixed_order") return `Selection rule: ${fixed}`;
  const band =
    measure === null
      ? "beyond their published accuracy"
      : `by more than ${toleranceText(measure)}`;
  return `Selection rule: when more than one source has a reading for the same measure and day and they differ ${band}, do not state a value: say it is held back, name the sources and say they disagree. Otherwise, ${fixed.charAt(0).toLowerCase()}${fixed.slice(1)}`;
};

const ACCURACY_MEASURE: Readonly<Record<SourceMeasure, AccuracyMeasure>> = {
  "resting-heart-rate": "restingHeartRate",
  "heart-rate-variability": "hrv",
  "oxygen-saturation": "spo2",
  "step-count": "energyExpenditure",
};

const DEVICES: Readonly<Record<WearableSourceId, readonly AccuracyDevice[]>> = {
  oura: ["oura"],
  whoop: ["whoop"],
  google_health: ["fitbit", "pixel-watch"],
  bodyloop: [],
};

const LEVEL_ORDER: readonly EvidenceLevel[] = ["none", "limited", "validated"];

const DEVICE_NAME: Readonly<Record<AccuracyDevice, string>> = {
  oura: "Oura",
  whoop: "WHOOP",
  fitbit: "Fitbit",
  "pixel-watch": "Pixel Watch",
};

/**
 * The accuracy line for one source and measure, with its evidence level;
 * null when the review has no note for it. Step counts have no note.
 */
export const accuracyLine = (
  source: WearableSourceId,
  measure: SourceMeasure | null,
): Readonly<{ level: EvidenceLevel; text: string }> | null => {
  const reviewed: AccuracyMeasure =
    measure === null ? "compositeScores" : ACCURACY_MEASURE[measure];
  if (measure === "step-count") return null;
  const notes = DEVICES[source].flatMap((device) =>
    ACCURACY_NOTES.filter((note) => note.device === device && note.measure === reviewed),
  );
  if (notes.length === 0) return null;
  const level =
    LEVEL_ORDER.find((candidate) => notes.some((note) => note.evidence === candidate)) ??
    "none";
  const what = measure === null ? "composite score" : MEASURE_LABEL[measure];
  const head =
    notes.length > 1
      ? `${WEARABLE_SOURCE_LABEL[source]} ${what} (the device behind a reading is not known: ${notes.map((note) => DEVICE_NAME[note.device]).join(" or ")}; evidence: ${level}):`
      : `${WEARABLE_SOURCE_LABEL[source]} ${what} (evidence: ${level}):`;
  const body =
    notes.length > 1
      ? notes.map((note) => `${DEVICE_NAME[note.device]}: ${note.note}`).join(" ")
      : (notes[0]?.note ?? "");
  return { level, text: `${head} ${body}` };
};

const metricLine = (metric: W1Metric, condition: Condition): string => {
  const base = `- ${formatForPrompt({ key: metric.key, label: metric.label, value: metric.value, ...(metric.unit === undefined ? {} : { unit: metric.unit }) })}`;
  return condition === "C0"
    ? base
    : `${base} (source: ${WEARABLE_SOURCE_LABEL[metric.source]}; day: ${formatDate(metric.date)})`;
};

/** The item's readings, source by source in listing order, newest day first within a source. */
export const listedMetrics = (item: W1Item): readonly W1Metric[] =>
  item.listing.flatMap((source) =>
    item.metrics
      .filter((metric) => metric.source === source)
      .sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key)),
  );

export const SYNTHETIC_NOTE =
  "The readings below belong to a synthetic test person; no real person's data is shown.";

/**
 * The prompt for one item under one condition. `order` is the fixed order
 * the rule names: the app's by default, reversed in the rule-swap rerun.
 */
export const studyPrompt = (
  item: W1Item,
  condition: Condition,
  order: readonly WearableSourceId[],
): StudyPrompt => {
  const lines = listedMetrics(item).map((metric) => metricLine(metric, condition));
  const notes =
    condition === "C2"
      ? item.listing.flatMap((source) => {
          const line = accuracyLine(source, item.measure);
          return line === null ? [] : [`- ${line.text}`];
        })
      : [];
  const system = [
    "You are TwinLLM, a research assistant for personalized-medicine questions.",
    "You are NOT a doctor. Do not diagnose or prescribe. Include uncertainty clearly.",
    "Always structure your reply with these exact markdown headings, in order:",
    "",
    "## Reasoning",
    SECTION_GUIDANCE.reasoning,
    "",
    "## Evidence Used",
    "Bullet list of wearable metric keys you relied on. Each line MUST be exactly:",
    "- [exact.key.from.list]",
    "Use only keys from the Available keys section below. If you used no wearable metric, write a single bullet:",
    "- none",
    "",
    "## Answer",
    SECTION_GUIDANCE.answer,
    "",
    "## Uncertainty",
    SECTION_GUIDANCE.uncertainty,
    "",
    "## Wearable context",
    SYNTHETIC_NOTE,
    "",
    "### Available keys (copy exactly into Evidence Used)",
    ...lines,
    ...(condition === "C0" ? [] : ["", ruleText(item.rule, order, item.measure)]),
    ...(notes.length === 0
      ? []
      : ["", "### How accurate each source is (published validation)", ...notes]),
    "",
    "If a question needs a reading you do not have in Available keys, say so under Uncertainty.",
  ].join("\n");
  return { system, user: item.question };
};
