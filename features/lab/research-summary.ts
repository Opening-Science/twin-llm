import { type Estimate } from "@/infrastructure/charts/kit/kit-geometry";
import { formatNumber } from "@/infrastructure/format-measure";

import { type ScoreCell } from "./eval-runs";
import { type Arm, type NoiseRow, type RuleChange, type ValueCi } from "./research-read";

/**
 * The "What we found" lines that open each study on `/lab/results`, built
 * from the same readers as the figures, so every number is a number in a
 * committed file. A summary whose numbers are missing is left out. The
 * status words are fixed: each is said in the study's page in
 * `docs/research/` or its paper dossier, as the comments name. Pure.
 */

type Study = "grounding" | "arrhythmia" | "heart-brain" | "disclosure";

export type StudySummary = Readonly<{ found: string }>;

/**
 * Status chips. Grounding: "one sample per line, no human review" in the
 * limits of `eval-runs-2026-10.md`. Arrhythmia and heart–brain: the paper
 * dossiers (P2, P3) plan a pre-registration that is not in the repository
 * yet. Disclosure: "one pilot, one control … one seed" in the limits of
 * `disclosure-2026-10.md`.
 */
export const STUDY_STATUS: Readonly<Record<Study, readonly string[]>> = {
  grounding: ["Needs human review", "One sample per answer"],
  arrhythmia: ["Pre-registration pending"],
  "heart-brain": ["Pre-registration pending"],
  disclosure: ["One pilot, one seed"],
};

const ofAnswers = (cell: ScoreCell): string =>
  `${cell.passes} of ${cell.n} (${Math.round((cell.passes / cell.n) * 100)}\u00a0%)`;

export type SummaryInput = Readonly<{
  arms: Readonly<{ arms: readonly Arm[]; heldOut: ScoreCell | null }> | null;
  noise: readonly NoiseRow[] | null;
  resolution: Readonly<{ byFeature: ReadonlyMap<string, ValueCi> }> | null;
  within: Readonly<{
    windows: readonly Readonly<{
      window: string;
      ratio: Readonly<{ ratio: number; low: number; high: number }>;
    }>[];
  }> | null;
  ruleChange: RuleChange | null;
  attacks: Readonly<{
    pilot: readonly Estimate[];
    served: readonly Estimate[];
    control: readonly Estimate[];
  }> | null;
}>;

const groundingFound = (arms: SummaryInput["arms"]): string | null => {
  const by = (id: string) => arms?.arms.find((a) => a.arm === id)?.cell;
  const tools = by("tools");
  const record = by("context-fair");
  const code = by("code");
  if (!tools || !record || !code) return null;
  const heldOut = arms?.heldOut;
  return [
    `With audited tools, qwen3:4b gave the right value in ${ofAnswers(tools)} scored answers.`,
    `Pasting the whole record into the prompt gave ${ofAnswers(record)}, and letting the model write code over the record ${ofAnswers(code)}.`,
    ...(heldOut
      ? [`On held-out questions with tools it was ${ofAnswers(heldOut)}.`]
      : []),
  ].join(" ");
};

const arrhythmiaFound = (
  noise: SummaryInput["noise"],
  resolution: SummaryInput["resolution"],
): string | null => {
  const clean = noise?.find((r) => r.noise === "none");
  const light = noise?.find((r) => r.noise === "light");
  if (!clean) return null;
  const beats = resolution?.byFeature.get("beat.flag_share");
  const night = resolution?.byFeature.get("day.hrv_rmssd");
  return [
    `On two open ECG databases the research flag found AF windows with sensitivity ${formatNumber(clean.afdb.sensitivity.value, 3)} and ${formatNumber(clean.ltafdb.sensitivity.value, 3)}, at specificity ${formatNumber(clean.afdb.specificity.value, 3)} and ${formatNumber(clean.ltafdb.specificity.value, 3)}.`,
    ...(light
      ? [
          `Light simulated beat-detection noise took specificity to ${formatNumber(light.afdb.specificity.value, 3)} and ${formatNumber(light.ltafdb.specificity.value, 3)}.`,
        ]
      : []),
    ...(beats && night
      ? [
          `On simulated days, beat windows separated AF days with AUROC ${formatNumber(beats.value, 3)} and night heart rate variability with ${formatNumber(night.value, 3)}.`,
        ]
      : []),
  ].join(" ");
};

const heartBrainFound = (
  within: SummaryInput["within"],
  rule: SummaryInput["ruleChange"],
): string | null => {
  const after = within?.windows.find((w) => w.window === "after")?.ratio;
  if (!after) return null;
  return [
    `In synthetic people the stroke rate after AF onset was ${formatNumber(after.ratio, 2)} times the rate before it (95 % interval ${formatNumber(after.low, 2)}–${formatNumber(after.high, 2)}).`,
    ...(rule
      ? [
          `Doubling the AF part of the generator's stroke rule moved the estimate from ${formatNumber(rule.base.ratio, 2)} to ${formatNumber(rule.doubled.ratio, 2)}, where the rules imply ${formatNumber(rule.base.expected, 2)} and ${formatNumber(rule.doubled.expected, 2)}.`,
        ]
      : []),
  ].join(" ");
};

const disclosureFound = (attacks: SummaryInput["attacks"]): string | null => {
  if (!attacks) return null;
  const pilot = [...attacks.pilot, ...attacks.served];
  const range = (rows: readonly Estimate[]) =>
    `${formatNumber(Math.min(...rows.map((r) => r.estimate)), 3)} to ${formatNumber(Math.max(...rows.map((r) => r.estimate)), 3)}`;
  const allSpanChance = pilot.every(
    (r) => r.low != null && r.high != null && r.low <= 0.5 && r.high >= 0.5,
  );
  return [
    `Membership attacks on the pilot 1 fine-tune scored AUROC ${range(pilot)} per record${allSpanChance ? ", and every interval included 0.5, the value for chance" : ""}.`,
    `On a deliberately overfit positive control the same attacks scored ${range(attacks.control)}.`,
  ].join(" ");
};

export const studySummaries = (
  input: SummaryInput,
): Readonly<Partial<Record<Study, StudySummary>>> => {
  const found: readonly (readonly [Study, string | null])[] = [
    ["grounding", groundingFound(input.arms)],
    ["arrhythmia", arrhythmiaFound(input.noise, input.resolution)],
    ["heart-brain", heartBrainFound(input.within, input.ruleChange)],
    ["disclosure", disclosureFound(input.attacks)],
  ];
  return Object.fromEntries(
    found.flatMap(([study, text]) => (text === null ? [] : [[study, { found: text }]])),
  );
};
