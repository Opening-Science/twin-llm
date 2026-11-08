import { type Estimate } from "@/infrastructure/charts/kit/kit-geometry";

import { type ScoreCell } from "./eval-runs";
import { type Interval } from "./research-markdown";
import {
  type Arm,
  type Attack,
  type Attacks,
  type HeartBrain,
  type NoiseRow,
  type Ratio,
  readAfResolution,
  readArms,
  readDisclosure,
  readHeartBrain,
  readNoiseTable,
  readRrGrid,
  readRuleChange,
  readSpecialists,
  readWithinPerson,
  RESEARCH_SOURCES,
  type ResearchFiles,
  type ResearchSource,
  type RrGrid,
  type RuleChange,
  type SpecialistRun,
  type ValueCi,
} from "./research-read";
import { type StudySummary, studySummaries } from "./research-summary";

/**
 * The committed research results as the Lab's figures, written for people
 * who did not run the studies. Each figure leads with a plain headline built
 * from its numbers, keeps the technical sentence as a caption, names its
 * axis, and shows the main comparison with the rest behind "Show all runs".
 * Every number comes from the readers in `research-read.ts`; this module only
 * picks, orders, names and rounds them. A source that is missing or has
 * changed shape drops its figure. Pure.
 */

export {
  RESEARCH_SOURCES,
  type ResearchFiles,
  type ResearchSource,
} from "./research-read";

export type ResearchStudy = "grounding" | "arrhythmia" | "heart-brain" | "disclosure";

export const STUDY_ORDER: readonly ResearchStudy[] = [
  "grounding",
  "arrhythmia",
  "heart-brain",
  "disclosure",
];

export const STUDY_TITLE: Readonly<Record<ResearchStudy, string>> = {
  grounding: "Numbers from tools",
  arrhythmia: "In-silico arrhythmia",
  "heart-brain": "Virtual heart–brain cohorts",
  disclosure: "Disclosure",
};

type Reference = Readonly<{ value: number; label: string }>;

export type ResearchFigureData =
  | Readonly<{
      kind: "estimates";
      estimates: readonly Estimate[];
      reference?: Reference;
      domain?: readonly [number, number];
    }>
  | Readonly<{
      kind: "pairs";
      groups: readonly Readonly<{
        label: string;
        estimates: readonly [Estimate, Estimate];
      }>[];
    }>;

export type ResearchCard = Readonly<{
  id: string;
  study: ResearchStudy;
  label: string;
  /** One plain sentence built from the figure's numbers; the card's lead and screen-reader text. */
  headline: string;
  /** The technical sentence: what exactly is measured, and its intervals. */
  caption: string;
  /** What the horizontal axis measures, with its unit or reference. */
  axis: string;
  /** The file every number comes from, relative to the repository. */
  source: string;
  /** The day the run's summary records, `YYYY-MM-DD`, or null when it records none. */
  runDate: string | null;
  figure: ResearchFigureData;
  /** Every row, behind a disclosure, when the figure shows only the main comparison. */
  more: Readonly<{ label: string; figure: ResearchFigureData }> | null;
}>;

export type ResearchRead = Readonly<{
  cards: readonly ResearchCard[];
  summaries: Readonly<Partial<Record<ResearchStudy, StudySummary>>>;
  /** Sources whose figure could not be made: missing, unreadable or changed shape. */
  unread: readonly string[];
}>;

/* --- words and numbers --------------------------------------------------------- */

const fixed = (value: number, decimals: number): string => value.toFixed(decimals);

const span = (low: number, high: number, decimals: number): string =>
  `${fixed(low, decimals)}–${fixed(high, decimals)}`;

/** A share of answers in whole per cent, from the file's counts. */
export const percent = (cell: ScoreCell): number =>
  Math.round((cell.passes / cell.n) * 100);

const ofAnswers = (cell: ScoreCell): string =>
  `${cell.passes} of ${cell.n} (${percent(cell)}\u00a0%)`;

const NO_EFFECT: Reference = { value: 1, label: "1 = no difference" };
const CHANCE: Reference = { value: 0.5, label: "0.5 = chance" };

const AXIS_SHARE = "% of scored answers right";
const AXIS_RATIO = "rate ratio (1 = no difference)";
const AXIS_AUROC = "AUROC (0.5 = chance)";

export const AGENT_NAME: Readonly<Record<string, string>> = {
  rhythm: "Heart rhythm",
  brain: "Brain",
  gp: "General",
};

export const SET_NAME: Readonly<Record<string, string>> = {
  v1: "main set (v1)",
  s7: "rhythm set (s7)",
  s7b: "second rhythm set (s7b)",
  s7h: "held-out rhythm set (s7h)",
};

const ARM_NAME: Readonly<Record<string, string>> = {
  tools: "Audited tools",
  "context-oracle": "Only the asked rows pasted in",
  "context-fair": "Whole record pasted in",
  code: "Model writes code",
};

const NOISE_NAME: Readonly<Record<string, string>> = {
  none: "no added noise",
  light: "light noise",
  heavy: "heavy noise",
};

const DB_NAME: Readonly<Record<string, string>> = { afdb: "AFDB", ltafdb: "LTAFDB" };

const MODE_NAME: Readonly<Record<string, string>> = {
  independent: "independent intervals",
  short_range: "short-range dependence",
};

const shareEstimate = (label: string, cell: ScoreCell): Estimate => ({
  label,
  estimate: (cell.passes / cell.n) * 100,
  low: cell.lowPct,
  high: cell.highPct,
  readout: `${label} · ${cell.passes}/${cell.n} right (${percent(cell)}\u00a0%), Wilson 95 % interval ${cell.lowPct}–${cell.highPct} %`,
});

const ratioEstimate = (label: string, r: Ratio, note = ""): Estimate => ({
  label,
  estimate: r.ratio,
  low: r.low,
  high: r.high,
  readout: `${label} · ${fixed(r.ratio, 2)} (95 % interval ${span(r.low, r.high, 2)})${note}`,
});

const valueEstimate = (label: string, measure: string, v: ValueCi): Estimate => ({
  label,
  estimate: v.value,
  low: v.ci95.low,
  high: v.ci95.high,
  readout: `${label} · ${measure} ${fixed(v.value, 3)} (95 % interval ${span(v.ci95.low, v.ci95.high, 3)})`,
});

const intervalEstimate = (group: string, measure: string, i: Interval): Estimate => ({
  label: measure,
  estimate: i.value,
  low: i.low,
  high: i.high,
  readout: `${group} · ${measure.toLowerCase()} ${fixed(i.value, 3)} (95 % interval ${span(i.low, i.high, 3)})`,
});

/* --- P1 grounding ------------------------------------------------------------- */

export const groundingCard = (
  data: Readonly<{ arms: readonly Arm[]; heldOut: ScoreCell | null }> | null,
): ResearchCard | null => {
  if (data === null) return null;
  const tools = data.arms.find((a) => a.arm === "tools");
  const record = data.arms.find((a) => a.arm === "context-fair");
  const estimates = [
    ...data.arms.map((a) => shareEstimate(ARM_NAME[a.arm] ?? a.arm, a.cell)),
    ...(data.heldOut === null
      ? []
      : [shareEstimate("Audited tools, held-out questions (v1h)", data.heldOut)]),
  ];
  const headline =
    tools && record
      ? `With audited tools, qwen3:4b gave the right value in ${ofAnswers(tools.cell)} scored answers; with the whole record pasted into the prompt, in ${ofAnswers(record.cell)}.`
      : `qwen3:4b gave the right value in ${data.arms.map((a) => `${ofAnswers(a.cell)} (${(ARM_NAME[a.arm] ?? a.arm).toLowerCase()})`).join(", ")} scored answers.`;
  return {
    id: "grounding-arms",
    study: "grounding",
    label: "How the data reaches the model",
    headline,
    caption:
      "Share of scored qwen3:4b answers with the right value on the main question set (v1), by how the synthetic record reached the model, and with tools on the held-out set (v1h). Lines are Wilson 95 % intervals.",
    axis: AXIS_SHARE,
    source: RESEARCH_SOURCES.evalRuns,
    runDate: null,
    figure: { kind: "estimates", estimates, domain: [0, 100] },
    more: null,
  };
};

const runLabel = (run: SpecialistRun): string =>
  `${AGENT_NAME[run.agent] ?? run.agent} agent, ${SET_NAME[run.set] ?? run.set}`;

/** One figure per model size: the same five agent and set pairs on each. */
export const specialistCards = (
  data: Readonly<{ date: string | null; runs: readonly SpecialistRun[] }> | null,
): readonly ResearchCard[] => {
  if (data === null) return [];
  const models = [...new Set(data.runs.map((r) => r.model))];
  return models.map((model) => {
    const runs = data.runs.filter((r) => r.model === model);
    const byShare = [...runs].sort(
      (a, b) => a.cell.passes / a.cell.n - b.cell.passes / b.cell.n,
    );
    const lowest = byShare[0]!;
    const highest = byShare.at(-1)!;
    return {
      id: `grounding-specialists-${model}`,
      study: "grounding",
      label: `Specialist agents on ${model}`,
      headline:
        runs.length === 1
          ? `On ${model}, the ${runLabel(lowest)} gave the right value in ${ofAnswers(lowest.cell)} scored answers.`
          : `On ${model}, the share of right values ran from ${ofAnswers(lowest.cell)} for the ${runLabel(lowest)} to ${ofAnswers(highest.cell)} for the ${runLabel(highest)}.`,
      caption: `Share of scored answers with the right value for each specialist agent and question set, with the agent's rules run on ${model}. Lines are Wilson 95 % intervals.`,
      axis: AXIS_SHARE,
      source: RESEARCH_SOURCES.specialists,
      runDate: data.date,
      figure: {
        kind: "estimates",
        estimates: runs.map((r) => shareEstimate(runLabel(r), r.cell)),
        domain: [0, 100],
      },
      more: null,
    };
  });
};

/* --- P2 in-silico arrhythmia -------------------------------------------------- */

const noiseGroups = (rows: readonly NoiseRow[]) =>
  rows.flatMap((row) =>
    (
      [
        ["AFDB", row.afdb],
        ["LTAFDB", row.ltafdb],
      ] as const
    ).map(([db, r]) => {
      const label = `${db}, ${NOISE_NAME[row.noise] ?? row.noise}`;
      return {
        label,
        estimates: [
          intervalEstimate(label, "Sensitivity", r.sensitivity),
          intervalEstimate(label, "Specificity", r.specificity),
        ] as const,
      };
    }),
  );

export const afDatabasesCard = (
  rows: readonly NoiseRow[] | null,
): ResearchCard | null => {
  if (rows === null) return null;
  const clean = rows.find((r) => r.noise === "none");
  const light = rows.find((r) => r.noise === "light");
  const headline = clean
    ? `With no added noise, the flag found AF windows with sensitivity ${fixed(clean.afdb.sensitivity.value, 3)} on AFDB and ${fixed(clean.ltafdb.sensitivity.value, 3)} on LTAFDB, at specificity ${fixed(clean.afdb.specificity.value, 3)} and ${fixed(clean.ltafdb.specificity.value, 3)}${light ? `; with light noise, specificity was ${fixed(light.afdb.specificity.value, 3)} and ${fixed(light.ltafdb.specificity.value, 3)}` : ""}.`
    : `The flag's sensitivity and specificity on AFDB and LTAFDB at ${rows.length} noise levels.`;
  return {
    id: "arrhythmia-databases",
    study: "arrhythmia",
    label: "AF flag on two open databases",
    headline,
    caption:
      "Sensitivity and specificity of the research flag for AF windows on the MIT-BIH AF database (AFDB) and the Long-term AF database (LTAFDB), with no, light and heavy simulated beat-detection noise. Lines are 95 % bootstrap intervals over records.",
    axis: "sensitivity and specificity (0–1)",
    source: RESEARCH_SOURCES.rhythmBench,
    runDate: null,
    figure: {
      kind: "pairs",
      groups: noiseGroups(clean ? [clean] : rows.slice(0, 1)),
    },
    more:
      rows.length > 1
        ? {
            label: "Show all noise levels",
            figure: { kind: "pairs", groups: noiseGroups(rows) },
          }
        : null,
  };
};

/** The ladder from beats to daily values; `main` marks the rows shown before "Show all". */
const LADDER: readonly Readonly<{ feature: string; label: string; main: boolean }>[] = [
  { feature: "beat.flag_share", label: "Beats: 128-beat windows flagged", main: true },
  { feature: "30s.irregular_share", label: "30 s epochs, irregular", main: false },
  { feature: "5min.irregular_share", label: "5 min epochs, irregular", main: false },
  { feature: "1h.irregular_share", label: "Hours, irregular", main: true },
  { feature: "unit.nrmssd", label: "Whole-day irregularity (nRMSSD)", main: false },
  { feature: "unit.heart_rate", label: "Daily heart rate", main: true },
  { feature: "day.resting_heart_rate", label: "Daily resting heart rate", main: true },
  { feature: "day.hrv_rmssd", label: "Night heart rate variability (RMSSD)", main: true },
];

export const afResolutionCard = (
  data: Readonly<{ date: string | null; byFeature: ReadonlyMap<string, ValueCi> }> | null,
): ResearchCard | null => {
  if (data === null) return null;
  const rows = LADDER.flatMap((step) => {
    const v = data.byFeature.get(step.feature);
    return v === undefined
      ? []
      : [{ ...step, estimate: valueEstimate(step.label, "AUROC", v), v }];
  });
  if (rows.length === 0) return null;
  const beats = rows.find((r) => r.feature === "beat.flag_share");
  const night = rows.find((r) => r.feature === "day.hrv_rmssd");
  const main = rows.filter((r) => r.main);
  return {
    id: "arrhythmia-resolution",
    study: "arrhythmia",
    label: "From beats to daily values",
    headline:
      beats && night
        ? `On simulated days with 2 % of the time in AF, beat windows told AF days from sinus days with AUROC ${fixed(beats.v.value, 3)}; night heart rate variability, a daily wearable value, with ${fixed(night.v.value, 3)}, where 0.5 is chance.`
        : `AUROC of AF days against sinus days at 2 % AF burden for ${rows.length} levels from beats to daily values.`,
    caption:
      "AUROC of simulated AF days against sinus days at 2 % AF burden, clean beats, as a change from each subject's own baseline, for each level from beat windows to the daily wearable values. Irregular means nRMSSD over 0.1. Lines are 95 % intervals over subjects.",
    axis: AXIS_AUROC,
    source: RESEARCH_SOURCES.afResolution,
    runDate: data.date,
    figure: {
      kind: "estimates",
      estimates: (main.length > 0 ? main : rows).map((r) => r.estimate),
      reference: CHANCE,
    },
    more:
      main.length > 0 && main.length < rows.length
        ? {
            label: "Show all levels",
            figure: {
              kind: "estimates",
              estimates: rows.map((r) => r.estimate),
              reference: CHANCE,
            },
          }
        : null,
  };
};

const gridWords = (ms: number): string =>
  ms === 0 ? "exact beat times" : `${ms} ms grid`;

export const rrGridCard = (data: RrGrid | null): ResearchCard | null => {
  if (data === null) return null;
  const real = data.real.map((r) =>
    valueEstimate(
      `${DB_NAME[r.database] ?? r.database}, ${r.records} records`,
      "mean TPR",
      r.tpr,
    ),
  );
  const simRow = (s: RrGrid["sim"][number]) =>
    valueEstimate(
      `Simulated, ${MODE_NAME[s.mode] ?? s.mode}, ${gridWords(s.gridMs)}`,
      "mean TPR",
      s.tpr,
    );
  const shortRange = data.sim.filter((s) => s.mode === "short_range");
  const main = [...real, ...shortRange.map(simRow)];
  const all = [...real, ...data.sim.map(simRow)];
  const first = shortRange[0];
  const last = shortRange.at(-1);
  const afdb = data.real.find((r) => r.database === "afdb");
  const ltafdb = data.real.find((r) => r.database === "ltafdb");
  return {
    id: "arrhythmia-rr-grid",
    study: "arrhythmia",
    label: "Recording resolution",
    headline:
      first && last && afdb && ltafdb
        ? `Real AF windows had a mean turning-point ratio of ${fixed(afdb.tpr.value, 3)} (AFDB) and ${fixed(ltafdb.tpr.value, 3)} (LTAFDB); simulated AF went from ${fixed(first.tpr.value, 3)} with exact beat times to ${fixed(last.tpr.value, 3)} with beats on a ${last.gridMs} ms grid.`
        : `Mean turning-point ratio of AF windows on ${all.length} sources.`,
    caption:
      "Mean turning-point ratio (TPR) of all-AF windows on the two databases and on simulated recordings with beat times put on a 0, 4 or 7.8125 ms grid, the databases' own sampling steps. Lines are 95 % bootstrap intervals.",
    axis: "mean turning-point ratio (TPR)",
    source: RESEARCH_SOURCES.rrGrid,
    runDate: data.date,
    figure: { kind: "estimates", estimates: main.length > real.length ? main : all },
    more:
      main.length > real.length && main.length < all.length
        ? { label: "Show all runs", figure: { kind: "estimates", estimates: all } }
        : null,
  };
};

/* --- P3 heart–brain ------------------------------------------------------------ */

const WINDOW_NAME: Readonly<Record<string, string>> = {
  after: "Any time after onset",
  "0-2 y": "0–2 years after",
  "2-5 y": "2–5 years after",
  "5+ y": "5 years and more after",
};

export const withinPersonCard = (
  data: ReturnType<typeof readWithinPerson>,
): ResearchCard | null => {
  if (data === null) return null;
  const after = data.windows.find((w) => w.window === "after");
  const people = data.people.toLocaleString("en");
  return {
    id: "heart-brain-within",
    study: "heart-brain",
    label: "Stroke after AF onset, within person",
    headline: after
      ? `In the same ${people} synthetic people, the stroke rate after AF onset was ${fixed(after.ratio.ratio, 2)} times the rate before it (95 % interval ${span(after.ratio.low, after.ratio.high, 2)}), age-adjusted.`
      : `Stroke rate after AF onset against before it in ${people} synthetic people, by time since onset.`,
    caption: `Age-adjusted (Mantel–Haenszel) stroke rate ratio after AF onset against before it in the same ${people} synthetic people, 100 Synthea batches, by time since onset. Lines are 95 % intervals.`,
    axis: AXIS_RATIO,
    source: RESEARCH_SOURCES.timing,
    runDate: null,
    figure: {
      kind: "estimates",
      estimates: data.windows.map((w) =>
        ratioEstimate(WINDOW_NAME[w.window] ?? w.window, w.ratio),
      ),
      reference: NO_EFFECT,
    },
    more: null,
  };
};

const expectedRow = (label: string, value: number): Estimate => ({
  label,
  estimate: value,
  readout: `${label} · ${fixed(value, 2)}, what the generator's rules imply`,
});

export const ruleChangeCard = (data: RuleChange | null): ResearchCard | null => {
  if (data === null) return null;
  const { base, doubled } = data;
  return {
    id: "heart-brain-rule-change",
    study: "heart-brain",
    label: "Changing a rule in the generator",
    headline: `With the stroke rule as shipped, the estimate was ${fixed(base.ratio, 2)} where the rules imply ${fixed(base.expected, 2)}; with the rule's AF part doubled, ${fixed(doubled.ratio, 2)} where they imply ${fixed(doubled.expected, 2)}.`,
    caption:
      "Within-person, age-adjusted stroke rate ratio after AF onset with Synthea's stroke rule as shipped and with its AF part doubled, each next to the ratio the rules imply (a dot without a line). Lines are 95 % intervals.",
    axis: AXIS_RATIO,
    source: RESEARCH_SOURCES.fullHistory,
    runDate: null,
    figure: {
      kind: "estimates",
      estimates: [
        ratioEstimate("Rule as shipped, estimate", base),
        expectedRow("Rule as shipped, expected", base.expected),
        ratioEstimate("AF part doubled, estimate", doubled),
        expectedRow("AF part doubled, expected", doubled.expected),
      ],
      reference: NO_EFFECT,
    },
    more: null,
  };
};

export const shuffledNullCard = (data: HeartBrain | null): ResearchCard | null => {
  if (data === null || data.observed === null) return null;
  const { observed, shuffled } = data;
  return {
    id: "heart-brain-shuffled",
    study: "heart-brain",
    label: "Observed against shuffled onset",
    headline: `People with AF had ${fixed(observed.ratio, 2)} times the stroke rate of matched people without; with AF onset dates shuffled, the same ratio averaged ${fixed(shuffled.mean, 2)} over ${shuffled.runs} runs (range ${span(shuffled.low, shuffled.high, 2)}).`,
    caption: `Matched between-person stroke rate ratio for AF then stroke, next to the mean and 95 % range of the same ratio over ${shuffled.runs} runs with AF onset dates shuffled. The summary keeps the range of the shuffled runs, not each run.`,
    axis: AXIS_RATIO,
    source: RESEARCH_SOURCES.heartBrain,
    runDate: data.date,
    figure: {
      kind: "estimates",
      estimates: [
        ratioEstimate("Observed", observed),
        ratioEstimate(
          `Shuffled onset, ${shuffled.runs} runs`,
          { ratio: shuffled.mean, low: shuffled.low, high: shuffled.high },
          ", mean and range of the runs",
        ),
      ],
      reference: NO_EFFECT,
    },
    more: null,
  };
};

const PLANTED_WORD: Readonly<Record<string, string>> = {
  direct: "linked directly by a rule",
  indirect: "linked through another value",
  none: "no rule links them",
};

/** Lowest and highest ratio among some pairs, as "a to b". */
const ratioRange = (ratios: readonly number[]): string =>
  `${fixed(Math.min(...ratios), 2)} to ${fixed(Math.max(...ratios), 2)}`;

export const plantedRulesCard = (data: HeartBrain | null): ResearchCard | null => {
  if (data === null || data.rules.length === 0) return null;
  const linked = data.rules.filter((r) => r.planted !== "none");
  const unlinked = data.rules.filter((r) => r.planted === "none");
  const row = (r: HeartBrain["rules"][number]) =>
    ratioEstimate(r.label, r.ratio, `; ${PLANTED_WORD[r.planted] ?? r.planted}`);
  const all = data.rules.map(row);
  return {
    id: "heart-brain-planted",
    study: "heart-brain",
    label: "Planted rules against recovered",
    headline:
      linked.length > 0 && unlinked.length > 0
        ? `For condition pairs the generator links by a rule, the matched ratios ran from ${ratioRange(linked.map((r) => r.ratio.ratio))}; for pairs no rule links, from ${ratioRange(unlinked.map((r) => r.ratio.ratio))}.`
        : `Matched rate ratios for ${data.rules.length} condition pairs.`,
    caption:
      "Matched between-person rate ratio for each pair of conditions the generator links by a rule or through another value; all pairs, including those no rule links, are under the figure. Lines are 95 % intervals.",
    axis: AXIS_RATIO,
    source: RESEARCH_SOURCES.heartBrain,
    runDate: data.date,
    figure: {
      kind: "estimates",
      estimates: linked.length > 0 ? linked.map(row) : all,
      reference: NO_EFFECT,
    },
    more:
      linked.length > 0 && unlinked.length > 0
        ? {
            label: "Show all pairs",
            figure: { kind: "estimates", estimates: all, reference: NO_EFFECT },
          }
        : null,
  };
};

/* --- P4 disclosure ------------------------------------------------------------- */

const attackRow = (label: string, a: Attack): Estimate => ({
  ...valueEstimate(label, "AUROC", a.auroc),
  readout: `${label} · AUROC ${fixed(a.auroc.value, 3)} (95 % interval ${span(a.auroc.ci95.low, a.auroc.ci95.high, 3)}), ${a.members} training and ${a.nonMembers} other records`,
});

/** The pilot rows and the control rows, as the figure and the summary both name them. */
export const disclosureRows = (attacks: Attacks) => ({
  pilot: [
    attackRow("Pilot 1, loss attack", attacks["pilot-checkpoint"].record.loss),
    attackRow("Pilot 1, reference attack", attacks["pilot-checkpoint"].record.reference),
  ],
  served: [
    attackRow("Pilot 1 as served, loss attack", attacks["pilot-served"].record.loss),
    attackRow(
      "Pilot 1 as served, reference attack",
      attacks["pilot-served"].record.reference,
    ),
  ],
  control: [
    attackRow("Positive control, loss attack", attacks.control.record.loss),
    attackRow(
      "Positive control, pilot 1 as reference",
      attacks["control-vs-pilot"].record.reference,
    ),
  ],
});

const aurocRange = (rows: readonly Estimate[]): string =>
  `${fixed(Math.min(...rows.map((r) => r.estimate)), 3)} to ${fixed(Math.max(...rows.map((r) => r.estimate)), 3)}`;

export const disclosureCard = (attacks: Attacks | null): ResearchCard | null => {
  if (attacks === null) return null;
  const { pilot, served, control } = disclosureRows(attacks);
  return {
    id: "disclosure-membership",
    study: "disclosure",
    label: "Can an attack tell training records apart?",
    headline: `Against the pilot 1 fine-tune the attacks scored AUROC ${aurocRange([...pilot, ...served])}; against a deliberately overfit positive control, ${aurocRange(control)}. 0.5 is chance.`,
    caption:
      "Membership-inference AUROC per record: how well loss and reference attacks tell the records a model was trained on from others, for the pilot 1 fine-tune (training checkpoint and the copy Ollama serves) and for a deliberately overfit positive control. Lines are 95 % intervals.",
    axis: AXIS_AUROC,
    source: RESEARCH_SOURCES.disclosure,
    runDate: null,
    figure: { kind: "estimates", estimates: [...pilot, ...control], reference: CHANCE },
    more: {
      label: "Show all runs",
      figure: {
        kind: "estimates",
        estimates: [...pilot, ...served, ...control],
        reference: CHANCE,
      },
    },
  };
};

/* --- all ------------------------------------------------------------------------- */

/** Every figure the files allow, in study order, the section summaries, and the sources that gave none. */
export const researchCards = (files: ResearchFiles): ResearchRead => {
  const arms = readArms(files.evalRuns);
  const specialists = readSpecialists(files.specialists);
  const noise = readNoiseTable(files.rhythmBench);
  const resolution = readAfResolution(files.afResolution);
  const rrGrid = readRrGrid(files.rrGrid);
  const within = readWithinPerson(files.timing);
  const ruleChange = readRuleChange(files.fullHistory);
  const heartBrain = readHeartBrain(files.heartBrain);
  const attacks = readDisclosure(files.disclosure);

  const built: readonly (readonly [ResearchSource, readonly ResearchCard[]])[] = [
    ["evalRuns", [groundingCard(arms)].flatMap((c) => (c ? [c] : []))],
    ["specialists", specialistCards(specialists)],
    ["rhythmBench", [afDatabasesCard(noise)].flatMap((c) => (c ? [c] : []))],
    ["afResolution", [afResolutionCard(resolution)].flatMap((c) => (c ? [c] : []))],
    ["rrGrid", [rrGridCard(rrGrid)].flatMap((c) => (c ? [c] : []))],
    ["timing", [withinPersonCard(within)].flatMap((c) => (c ? [c] : []))],
    ["fullHistory", [ruleChangeCard(ruleChange)].flatMap((c) => (c ? [c] : []))],
    [
      "heartBrain",
      [shuffledNullCard(heartBrain), plantedRulesCard(heartBrain)].flatMap((c) =>
        c ? [c] : [],
      ),
    ],
    ["disclosure", [disclosureCard(attacks)].flatMap((c) => (c ? [c] : []))],
  ];
  const cards = built.flatMap(([, list]) => list);
  return {
    cards: STUDY_ORDER.flatMap((study) => cards.filter((c) => c.study === study)),
    summaries: studySummaries({
      arms,
      noise,
      resolution,
      within,
      ruleChange,
      attacks: attacks === null ? null : disclosureRows(attacks),
    }),
    unread: built
      .filter(([, list]) => list.length === 0)
      .map(([s]) => RESEARCH_SOURCES[s]),
  };
};
