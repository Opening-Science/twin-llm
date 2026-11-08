import { z } from "zod";

import { type Estimate } from "@/infrastructure/charts/kit/kit-geometry";

import { parseScoreCell, type ScoreCell } from "./eval-runs";
import { markdownTable, parseBracketInterval } from "./research-markdown";

/**
 * The committed research results (`docs/research/`) as the Lab's research
 * figures. Each figure reads one file: a `*.summary.json` a study wrote,
 * or, where a study has no machine-readable summary, one table of its page
 * found by its exact header. Every number on a figure is a number in that
 * file; this module only picks, orders and labels them, and writes the
 * readouts with the file's own decimals or fewer. A file that is missing or
 * no longer has the expected shape drops its figure; it never falls back to
 * a number written here. Pure.
 */

export const RESEARCH_SOURCES = {
  evalRuns: "docs/research/eval-runs-2026-10.md",
  specialists: "docs/research/eval-specialists-4b-2026-11.summary.json",
  rhythmBench: "docs/research/rhythm-bench-2026-10.md",
  afResolution: "docs/research/af-resolution-2026-10.summary.json",
  rrGrid: "docs/research/rhythm-bench-2026-10.rr-grid.summary.json",
  heartBrain: "docs/research/heart-brain-2026-10.summary.json",
  timing: "docs/research/heart-brain-timing-2026-10.summary.json",
  fullHistory: "docs/research/heart-brain-full-history-2026-11.summary.json",
  disclosure: "docs/research/disclosure-2026-10.summary.json",
} as const;

export type ResearchSource = keyof typeof RESEARCH_SOURCES;

/** File text by source; a source that could not be read is left out. */
export type ResearchFiles = Readonly<Partial<Record<ResearchSource, string>>>;

export type ResearchStudy = "grounding" | "arrhythmia" | "heart-brain" | "disclosure";

export const STUDY_TITLE: Readonly<Record<ResearchStudy, string>> = {
  grounding: "Numbers from tools",
  arrhythmia: "In-silico arrhythmia",
  "heart-brain": "Virtual heart–brain cohorts",
  disclosure: "Disclosure",
};

export const STUDY_ORDER: readonly ResearchStudy[] = [
  "grounding",
  "arrhythmia",
  "heart-brain",
  "disclosure",
];

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
  /** One plain sentence on what the figure shows; also its screen-reader text. */
  sentence: string;
  /** The file every number comes from, relative to the repository. */
  source: string;
  /** The day the run's summary records, `YYYY-MM-DD`, or null when it records none. */
  runDate: string | null;
  figure: ResearchFigureData;
}>;

export type ResearchRead = Readonly<{
  cards: readonly ResearchCard[];
  /** Sources whose figure could not be made: missing, unreadable or changed shape. */
  unread: readonly string[];
}>;

/* --- helpers ----------------------------------------------------------------- */

const fixed = (value: number, decimals: number): string => value.toFixed(decimals);

const ratioText = (value: number, low: number, high: number, decimals = 2): string =>
  `${fixed(value, decimals)} (${fixed(low, decimals)}–${fixed(high, decimals)})`;

const parseJson = <T>(text: string | undefined, schema: z.ZodType<T>): T | null => {
  if (text === undefined) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const day = (iso: string | undefined): string | null =>
  iso !== undefined && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : null;

const ci = z.object({ low: z.number(), high: z.number() });
const valueCi = z.object({ value: z.number(), ci95: ci });
const ratioLowHigh = z.object({ ratio: z.number(), low: z.number(), high: z.number() });

const NO_EFFECT: Reference = { value: 1, label: "1 = no difference" };
const CHANCE: Reference = { value: 0.5, label: "0.5 = chance" };

/** A Wilson cell as a share in per cent, with the file's own interval. */
const wilsonEstimate = (label: string, cell: ScoreCell): Estimate => ({
  label,
  estimate: (cell.passes / cell.n) * 100,
  low: cell.lowPct,
  high: cell.highPct,
  readout: `${label} · ${cell.passes}/${cell.n} correct, Wilson 95 % ${cell.lowPct}–${cell.highPct} %`,
});

/* --- P1 grounding --------------------------------------------------------------- */

const ARM_LABEL: Readonly<Record<string, string>> = {
  tools: "Audited tools",
  "context-oracle": "Key's own rows in the prompt",
  "context-fair": "Whole record in the prompt",
  code: "Code over the record",
};

/** qwen3:4b correctness per arm (#320, #303) and on the held-out set (#304), from the page's tables. */
export const groundingCard = (markdown: string | undefined): ResearchCard | null => {
  if (markdown === undefined) return null;
  const arms = markdownTable(
    markdown,
    ["Arm", "Correctness", "Human share"],
    "### Code over the record (#303)",
  );
  const heldOut = markdownTable(
    markdown,
    ["Criterion", "S1", "S2", "S3", "S5", "S6", "All"],
    "## Held-out set v1h (#304)",
  );
  if (arms === null) return null;
  const armRows = arms.flatMap((row) => {
    const cell = parseScoreCell(row[1] ?? "");
    const arm = row[0] ?? "";
    return cell === null ? [] : [wilsonEstimate(ARM_LABEL[arm] ?? arm, cell)];
  });
  const heldOutCell = (() => {
    const row = heldOut?.find((r) => r[0] === "correctness");
    return row === undefined ? null : parseScoreCell(row[6] ?? "");
  })();
  const estimates = [
    ...armRows,
    ...(heldOutCell === null
      ? []
      : [wilsonEstimate("Audited tools, held-out questions", heldOutCell)]),
  ];
  if (estimates.length === 0) return null;
  return {
    id: "grounding-arms",
    study: "grounding",
    label: "Correctness by design",
    sentence:
      "Share of scored qwen3:4b answers with the right value, by how the synthetic record reached the model, with Wilson 95 % intervals.",
    source: RESEARCH_SOURCES.evalRuns,
    runDate: null,
    figure: { kind: "estimates", estimates, domain: [0, 100] },
  };
};

const specialistsSchema = z.object({
  date: z.string().optional(),
  runs: z.array(
    z.object({
      agent: z.string(),
      set: z.string(),
      base_model_id: z.string(),
      sensitivity_preamble_cut: z.boolean(),
      correctness: z.string(),
    }),
  ),
});

/** Each specialist agent per question set on qwen3:4b and qwen3:8b (#425); the rescored -cut runs are left out. */
export const specialistsCard = (text: string | undefined): ResearchCard | null => {
  const data = parseJson(text, specialistsSchema);
  if (data === null) return null;
  const estimates = data.runs.flatMap((run) => {
    if (run.sensitivity_preamble_cut) return [];
    const cell = parseScoreCell(run.correctness);
    return cell === null
      ? []
      : [wilsonEstimate(`${run.agent} on ${run.set}, ${run.base_model_id}`, cell)];
  });
  if (estimates.length === 0) return null;
  return {
    id: "grounding-specialists",
    study: "grounding",
    label: "Specialists on two model sizes",
    sentence:
      "Share of scored answers with the right value for each specialist agent and question set, on qwen3:4b and qwen3:8b, with Wilson 95 % intervals.",
    source: RESEARCH_SOURCES.specialists,
    runDate: day(data.date),
    figure: { kind: "estimates", estimates, domain: [0, 100] },
  };
};

/* --- P2 in-silico arrhythmia ---------------------------------------------------- */

const NOISE_HEADER = [
  "Noise",
  "AF database sensitivity",
  "AF database specificity",
  "LTAFDB sensitivity",
  "LTAFDB specificity",
  "Sim specificity, grid",
] as const;

const pairEstimate = (group: string, measure: string, text: string): Estimate | null => {
  const interval = parseBracketInterval(text);
  return interval === null
    ? null
    : {
        label: measure,
        estimate: interval.value,
        low: interval.low,
        high: interval.high,
        readout: `${group} · ${measure.toLowerCase()} ${ratioText(interval.value, interval.low, interval.high, 3)}`,
      };
};

/** The flag on both databases at each noise level, from the page's side-by-side table (#264). */
export const afDatabasesCard = (markdown: string | undefined): ResearchCard | null => {
  if (markdown === undefined) return null;
  const rows = markdownTable(markdown, NOISE_HEADER);
  if (rows === null) return null;
  const groups = rows.flatMap((row) => {
    const noise = row[0] ?? "";
    return (
      [
        ["AFDB", row[1], row[2]],
        ["LTAFDB", row[3], row[4]],
      ] as const
    ).flatMap(([db, sens, spec]) => {
      const label = `${db}, noise ${noise}`;
      const a = pairEstimate(label, "Sensitivity", sens ?? "");
      const b = pairEstimate(label, "Specificity", spec ?? "");
      return a === null || b === null
        ? []
        : [{ label, estimates: [a, b] as const satisfies readonly [Estimate, Estimate] }];
    });
  });
  if (groups.length === 0) return null;
  return {
    id: "arrhythmia-databases",
    study: "arrhythmia",
    label: "AF flag on two databases",
    sentence:
      "Sensitivity and specificity of the research flag for AF windows on the MIT-BIH AF Database (AFDB) and the Long-Term AF Database (LTAFDB), with no, light and heavy simulated beat-detection noise, with 95 % bootstrap intervals over records.",
    source: RESEARCH_SOURCES.rhythmBench,
    runDate: null,
    figure: { kind: "pairs", groups },
  };
};

const afResolutionSchema = z.object({
  generatedAt: z.string().optional(),
  dayAurocs: z.array(
    z.object({
      noise: z.string(),
      feature: z.string(),
      variant: z.string(),
      burden: z.union([z.number(), z.string()]),
      auroc: valueCi,
    }),
  ),
});

/** The ladder from beats to the daily wearable values, in the page's order and words. */
const LADDER: readonly (readonly [string, string])[] = [
  ["beat.flag_share", "Beats: 128-beat windows flagged"],
  ["30s.irregular_share", "30 s epochs, nRMSSD over 0.1"],
  ["5min.irregular_share", "5 min epochs, nRMSSD over 0.1"],
  ["1h.irregular_share", "Hours, nRMSSD over 0.1"],
  ["unit.nrmssd", "nRMSSD over the whole day"],
  ["unit.heart_rate", "Daily heart rate"],
  ["day.resting_heart_rate", "Daily resting heart rate"],
  ["day.hrv_rmssd", "Night RMSSD"],
];

/** AF days against sinus days at 2 % burden, clean beats, as a change from each subject's baseline (#290). */
export const afResolutionCard = (text: string | undefined): ResearchCard | null => {
  const data = parseJson(text, afResolutionSchema);
  if (data === null) return null;
  const estimates = LADDER.flatMap(([feature, label]) => {
    const row = data.dayAurocs.find(
      (r) =>
        r.feature === feature &&
        r.noise === "none" &&
        r.variant === "change" &&
        r.burden === 0.02,
    );
    if (row === undefined) return [];
    const { value, ci95 } = row.auroc;
    return [
      {
        label,
        estimate: value,
        low: ci95.low,
        high: ci95.high,
        readout: `${label} · AUROC ${ratioText(value, ci95.low, ci95.high, 3)}`,
      },
    ];
  });
  if (estimates.length === 0) return null;
  return {
    id: "arrhythmia-resolution",
    study: "arrhythmia",
    label: "From beats to daily values",
    sentence:
      "AUROC of simulated AF days against sinus days at 2 % AF burden, clean beats, for each level from beat windows to the daily wearable values, with 95 % intervals over subjects.",
    source: RESEARCH_SOURCES.afResolution,
    runDate: day(data.generatedAt),
    figure: { kind: "estimates", estimates, reference: CHANCE },
  };
};

const centres = z.object({ mean: z.object({ tpr: valueCi }) });
const rrGridSchema = z.object({
  generatedAt: z.string().optional(),
  real: z.array(z.object({ database: z.string(), records: z.number(), centres })),
  sim: z.array(z.object({ mode: z.string(), gridMs: z.number(), centres })),
});

const DATABASE_NAME: Readonly<Record<string, string>> = {
  afdb: "AFDB",
  ltafdb: "LTAFDB",
};

/** Mean turning-point ratio of all-AF windows, real and simulated on each RR grid (#418). */
export const rrGridCard = (text: string | undefined): ResearchCard | null => {
  const data = parseJson(text, rrGridSchema);
  if (data === null) return null;
  const row = (label: string, tpr: z.infer<typeof valueCi>): Estimate => ({
    label,
    estimate: tpr.value,
    low: tpr.ci95.low,
    high: tpr.ci95.high,
    readout: `${label} · mean TPR ${ratioText(tpr.value, tpr.ci95.low, tpr.ci95.high, 3)}`,
  });
  const estimates = [
    ...data.real.map((r) =>
      row(
        `${DATABASE_NAME[r.database] ?? r.database}, ${r.records} records`,
        r.centres.mean.tpr,
      ),
    ),
    ...data.sim.map((s) =>
      row(
        `Simulated ${s.mode.replace("_", "-")}, ${s.gridMs} ms grid`,
        s.centres.mean.tpr,
      ),
    ),
  ];
  if (estimates.length === 0) return null;
  return {
    id: "arrhythmia-rr-grid",
    study: "arrhythmia",
    label: "RR resolution",
    sentence:
      "Mean turning-point ratio of all-AF windows on the two databases and on simulated recordings with beat times put on a 0, 4 or 7.8125 ms grid, with 95 % bootstrap intervals.",
    source: RESEARCH_SOURCES.rrGrid,
    runDate: day(data.generatedAt),
    figure: { kind: "estimates", estimates },
  };
};

/* --- P3 heart–brain ----------------------------------------------------------- */

const ratioEstimate = (
  label: string,
  r: Readonly<{ ratio: number; low: number; high: number }>,
  note = "",
): Estimate => ({
  label,
  estimate: r.ratio,
  low: r.low,
  high: r.high,
  readout: `${label} · ${ratioText(r.ratio, r.low, r.high)}${note}`,
});

const timingSchema = z.object({
  timing: z.object({
    batches001to100: z.array(
      z.object({
        minAgeYears: z.number(),
        withinPerson: z.object({
          people: z.number(),
          windows: z.array(z.object({ window: z.string(), ageAdjustedMH: ratioLowHigh })),
        }),
      }),
    ),
  }),
});

const WINDOW_LABEL: Readonly<Record<string, string>> = {
  after: "Any time after onset",
  "0-2 y": "0–2 years after",
  "2-5 y": "2–5 years after",
  "5+ y": "5 years and more after",
};

/** Within-person stroke rate after AF onset against before it, 100 batches, all ages (#262). */
export const withinPersonCard = (text: string | undefined): ResearchCard | null => {
  const data = parseJson(text, timingSchema);
  const all = data?.timing.batches001to100.find((b) => b.minAgeYears === 0);
  if (all === undefined) return null;
  const estimates = all.withinPerson.windows.map((w) =>
    ratioEstimate(WINDOW_LABEL[w.window] ?? w.window, w.ageAdjustedMH),
  );
  if (estimates.length === 0) return null;
  return {
    id: "heart-brain-within",
    study: "heart-brain",
    label: "Stroke after AF onset, within person",
    sentence: `Age-adjusted stroke rate after AF onset against before it in the same ${all.withinPerson.people.toLocaleString("en")} synthetic people, by time since onset, with 95 % intervals.`,
    source: RESEARCH_SOURCES.timing,
    runDate: null,
    figure: { kind: "estimates", estimates, reference: NO_EFFECT },
  };
};

const fullHistorySchema = z.object({
  ruleChange: z.object({
    base: z.object({
      withinAgeAdjusted: ratioLowHigh.extend({ expected: z.number() }),
    }),
    afTimesTwo: z.object({
      withinAgeAdjusted: ratioLowHigh.extend({ expectedFactor2: z.number() }),
    }),
  }),
});

const expectedRow = (label: string, value: number): Estimate => ({
  label,
  estimate: value,
  readout: `${label} · ${fixed(value, 2)}`,
});

/** The rule-change test (#295): the estimate moves with the generator's stroke rule. */
export const ruleChangeCard = (text: string | undefined): ResearchCard | null => {
  const data = parseJson(text, fullHistorySchema);
  if (data === null) return null;
  const { base, afTimesTwo } = data.ruleChange;
  return {
    id: "heart-brain-rule-change",
    study: "heart-brain",
    label: "Rule change in the generator",
    sentence:
      "Within-person, age-adjusted stroke rate ratio after AF onset with the stroke rule as shipped and with its AF part doubled, each next to the ratio the rules imply.",
    source: RESEARCH_SOURCES.fullHistory,
    runDate: null,
    figure: {
      kind: "estimates",
      estimates: [
        ratioEstimate("Rule as shipped, estimate", base.withinAgeAdjusted),
        expectedRow("Rule as shipped, expected", base.withinAgeAdjusted.expected),
        ratioEstimate("AF part doubled, estimate", afTimesTwo.withinAgeAdjusted),
        expectedRow(
          "AF part doubled, expected",
          afTimesTwo.withinAgeAdjusted.expectedFactor2,
        ),
      ],
      reference: NO_EFFECT,
    },
  };
};

const heartBrainSchema = z.object({
  generatedAt: z.string().optional(),
  study: z.object({
    rules: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        planted: z.string(),
        ratio: z.object({ ratio: z.number(), ci: ci }).nullable(),
      }),
    ),
    shuffled: z.object({
      observedRatio: z.number(),
      ratio: z.object({
        mean: z.number(),
        low: z.number(),
        high: z.number(),
        runs: z.number(),
      }),
    }),
  }),
});

/** The matched AF-then-stroke ratio against the same ratio with onset dates shuffled. */
export const shuffledNullCard = (text: string | undefined): ResearchCard | null => {
  const data = parseJson(text, heartBrainSchema);
  if (data === null) return null;
  const { shuffled, rules } = data.study;
  const observed = rules.find((r) => r.id === "af-stroke")?.ratio;
  if (observed == null) return null;
  return {
    id: "heart-brain-shuffled",
    study: "heart-brain",
    label: "Observed against shuffled onset",
    sentence: `Matched stroke rate ratio for AF then stroke, next to the mean and 95 % range of the same ratio over ${shuffled.ratio.runs} runs with AF onset dates shuffled.`,
    source: RESEARCH_SOURCES.heartBrain,
    runDate: day(data.generatedAt),
    figure: {
      kind: "estimates",
      estimates: [
        ratioEstimate("Observed", {
          ratio: shuffled.observedRatio,
          low: observed.ci.low,
          high: observed.ci.high,
        }),
        ratioEstimate(
          `Shuffled onset, ${shuffled.ratio.runs} runs`,
          {
            ratio: shuffled.ratio.mean,
            low: shuffled.ratio.low,
            high: shuffled.ratio.high,
          },
          " (mean and 95 % range)",
        ),
      ],
      reference: NO_EFFECT,
    },
  };
};

const PLANTED_WORD: Readonly<Record<string, string>> = {
  direct: "linked directly by a rule",
  indirect: "linked through another value",
  none: "no rule links them",
};

/** Each condition pair's matched ratio, with whether the generator links the two (planted against recovered). */
export const plantedRulesCard = (text: string | undefined): ResearchCard | null => {
  const data = parseJson(text, heartBrainSchema);
  if (data === null) return null;
  const estimates = data.study.rules.flatMap((rule) =>
    rule.ratio === null
      ? []
      : [
          ratioEstimate(
            rule.label,
            { ratio: rule.ratio.ratio, low: rule.ratio.ci.low, high: rule.ratio.ci.high },
            `; ${PLANTED_WORD[rule.planted] ?? rule.planted}`,
          ),
        ],
  );
  if (estimates.length === 0) return null;
  return {
    id: "heart-brain-planted",
    study: "heart-brain",
    label: "Planted rules against recovered",
    sentence:
      "Matched rate ratio for each pair of conditions, for pairs the generator links by a rule, through another value or not at all, with 95 % intervals.",
    source: RESEARCH_SOURCES.heartBrain,
    runDate: day(data.generatedAt),
    figure: { kind: "estimates", estimates, reference: NO_EFFECT },
  };
};

/* --- P4 disclosure ------------------------------------------------------------- */

const attack = z.object({ members: z.number(), nonMembers: z.number(), auroc: valueCi });
const level = z.object({ record: z.object({ loss: attack, reference: attack }) });
const disclosureSchema = z.object({
  attacks: z.object({
    "pilot-checkpoint": level,
    "pilot-served": level,
    control: level,
    "control-vs-pilot": level,
  }),
});

/** Membership-inference AUROC per record: the pilot fine-tune and the overfit positive control (#301). */
export const disclosureCard = (text: string | undefined): ResearchCard | null => {
  const data = parseJson(text, disclosureSchema);
  if (data === null) return null;
  const { attacks } = data;
  const row = (label: string, a: z.infer<typeof attack>): Estimate => ({
    label,
    estimate: a.auroc.value,
    low: a.auroc.ci95.low,
    high: a.auroc.ci95.high,
    readout: `${label} · AUROC ${ratioText(a.auroc.value, a.auroc.ci95.low, a.auroc.ci95.high, 3)}, ${a.members} members and ${a.nonMembers} non-members`,
  });
  return {
    id: "disclosure-membership",
    study: "disclosure",
    label: "Membership inference",
    sentence:
      "How well loss and reference attacks tell training records from others, as AUROC per record, for the pilot 1 fine-tune and for a deliberately overfit positive control, with 95 % intervals.",
    source: RESEARCH_SOURCES.disclosure,
    runDate: null,
    figure: {
      kind: "estimates",
      estimates: [
        row("Pilot 1 checkpoint, loss", attacks["pilot-checkpoint"].record.loss),
        row(
          "Pilot 1 checkpoint, reference",
          attacks["pilot-checkpoint"].record.reference,
        ),
        row("Pilot 1 served, loss", attacks["pilot-served"].record.loss),
        row("Pilot 1 served, reference", attacks["pilot-served"].record.reference),
        row("Positive control, loss", attacks.control.record.loss),
        row(
          "Positive control, pilot 1 as reference",
          attacks["control-vs-pilot"].record.reference,
        ),
      ],
      reference: CHANCE,
    },
  };
};

/* --- all ----------------------------------------------------------------------- */

const BUILDERS: readonly (readonly [
  ResearchSource,
  (text: string | undefined) => ResearchCard | null,
])[] = [
  ["evalRuns", groundingCard],
  ["specialists", specialistsCard],
  ["rhythmBench", afDatabasesCard],
  ["afResolution", afResolutionCard],
  ["rrGrid", rrGridCard],
  ["timing", withinPersonCard],
  ["fullHistory", ruleChangeCard],
  ["heartBrain", shuffledNullCard],
  ["heartBrain", plantedRulesCard],
  ["disclosure", disclosureCard],
];

/** Every figure the files allow, in study order; the sources that gave none are named. */
export const researchCards = (files: ResearchFiles): ResearchRead => {
  const built = BUILDERS.map(([source, build]) => ({
    source,
    card: build(files[source]),
  }));
  const cards = built.flatMap(({ card }) => (card === null ? [] : [card]));
  const unread = [
    ...new Set(
      built
        .filter(({ card }) => card === null)
        .map(({ source }) => RESEARCH_SOURCES[source]),
    ),
  ];
  return {
    cards: STUDY_ORDER.flatMap((study) => cards.filter((c) => c.study === study)),
    unread,
  };
};
