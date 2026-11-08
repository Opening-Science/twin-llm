import { z } from "zod";

import { parseScoreCell, type ScoreCell } from "./eval-runs";
import { type Interval, markdownTable, parseBracketInterval } from "./research-markdown";

/**
 * Reading the committed research files (`docs/research/`) into typed data,
 * one reader per file. A reader takes the file's text and returns only the
 * fields the Lab shows, or null when the file is missing or has changed
 * shape (a Markdown table is found by its exact header). The figures
 * (`research-results.ts`) and the section summaries
 * (`research-summary.ts`) are both built from these, so every number they
 * write is a number in a file. Pure.
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

const parseJson = <T>(text: string | undefined, schema: z.ZodType<T>): T | null => {
  if (text === undefined) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

/** The `YYYY-MM-DD` start of an ISO date, or null. */
export const isoDay = (iso: string | undefined): string | null =>
  iso !== undefined && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : null;

const ci = z.object({ low: z.number(), high: z.number() });
const valueCi = z.object({ value: z.number(), ci95: ci });
const ratioLowHigh = z.object({ ratio: z.number(), low: z.number(), high: z.number() });

export type Ratio = z.infer<typeof ratioLowHigh>;
export type ValueCi = z.infer<typeof valueCi>;

/* --- P1 ---------------------------------------------------------------------- */

export type Arm = Readonly<{ arm: string; cell: ScoreCell }>;

/** qwen3:4b per arm (#320, #303) and on the held-out set v1h (#304), from the page's two tables. */
export const readArms = (
  markdown: string | undefined,
): Readonly<{ arms: readonly Arm[]; heldOut: ScoreCell | null }> | null => {
  if (markdown === undefined) return null;
  const table = markdownTable(
    markdown,
    ["Arm", "Correctness", "Human share"],
    "### Code over the record (#303)",
  );
  if (table === null) return null;
  const arms = table.flatMap((row) => {
    const cell = parseScoreCell(row[1] ?? "");
    return cell === null ? [] : [{ arm: row[0] ?? "", cell }];
  });
  if (arms.length === 0) return null;
  const heldOutRow = markdownTable(
    markdown,
    ["Criterion", "S1", "S2", "S3", "S5", "S6", "All"],
    "## Held-out set v1h (#304)",
  )?.find((row) => row[0] === "correctness");
  return {
    arms,
    heldOut: heldOutRow === undefined ? null : parseScoreCell(heldOutRow[6] ?? ""),
  };
};

export type SpecialistRun = Readonly<{
  agent: string;
  set: string;
  model: string;
  cell: ScoreCell;
}>;

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

/** The specialist runs (#425) without the rescored `-cut` runs. */
export const readSpecialists = (
  text: string | undefined,
): Readonly<{ date: string | null; runs: readonly SpecialistRun[] }> | null => {
  const data = parseJson(text, specialistsSchema);
  if (data === null) return null;
  const runs = data.runs.flatMap((run) => {
    if (run.sensitivity_preamble_cut) return [];
    const cell = parseScoreCell(run.correctness);
    return cell === null
      ? []
      : [{ agent: run.agent, set: run.set, model: run.base_model_id, cell }];
  });
  return runs.length === 0 ? null : { date: isoDay(data.date), runs };
};

/* --- P2 ---------------------------------------------------------------------- */

export type NoiseRow = Readonly<{
  noise: string;
  afdb: Readonly<{ sensitivity: Interval; specificity: Interval }>;
  ltafdb: Readonly<{ sensitivity: Interval; specificity: Interval }>;
}>;

/** The flag on both databases per noise level, the side-by-side table of the benchmark page (#264). */
export const readNoiseTable = (
  markdown: string | undefined,
): readonly NoiseRow[] | null => {
  if (markdown === undefined) return null;
  const table = markdownTable(markdown, [
    "Noise",
    "AF database sensitivity",
    "AF database specificity",
    "LTAFDB sensitivity",
    "LTAFDB specificity",
    "Sim specificity, grid",
  ]);
  if (table === null) return null;
  const rows = table.flatMap((row) => {
    const [a, b, c, d] = [1, 2, 3, 4].map((i) => parseBracketInterval(row[i] ?? ""));
    return a && b && c && d
      ? [
          {
            noise: row[0] ?? "",
            afdb: { sensitivity: a, specificity: b },
            ltafdb: { sensitivity: c, specificity: d },
          },
        ]
      : [];
  });
  return rows.length === 0 ? null : rows;
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

/** AF days against sinus days at 2 % burden, clean beats, change from baseline (#290), by feature. */
export const readAfResolution = (
  text: string | undefined,
): Readonly<{ date: string | null; byFeature: ReadonlyMap<string, ValueCi> }> | null => {
  const data = parseJson(text, afResolutionSchema);
  if (data === null) return null;
  const rows = data.dayAurocs.filter(
    (r) => r.noise === "none" && r.variant === "change" && r.burden === 0.02,
  );
  if (rows.length === 0) return null;
  return {
    date: isoDay(data.generatedAt),
    byFeature: new Map(rows.map((r) => [r.feature, r.auroc])),
  };
};

const centres = z.object({ mean: z.object({ tpr: valueCi }) });
const rrGridSchema = z.object({
  generatedAt: z.string().optional(),
  real: z.array(z.object({ database: z.string(), records: z.number(), centres })),
  sim: z.array(z.object({ mode: z.string(), gridMs: z.number(), centres })),
});

export type RrGrid = Readonly<{
  date: string | null;
  real: readonly Readonly<{ database: string; records: number; tpr: ValueCi }>[];
  sim: readonly Readonly<{ mode: string; gridMs: number; tpr: ValueCi }>[];
}>;

/** Mean turning-point ratio of all-AF windows, real and simulated on each RR grid (#418). */
export const readRrGrid = (text: string | undefined): RrGrid | null => {
  const data = parseJson(text, rrGridSchema);
  if (data === null || data.real.length + data.sim.length === 0) return null;
  return {
    date: isoDay(data.generatedAt),
    real: data.real.map((r) => ({
      database: r.database,
      records: r.records,
      tpr: r.centres.mean.tpr,
    })),
    sim: data.sim.map((s) => ({
      mode: s.mode,
      gridMs: s.gridMs,
      tpr: s.centres.mean.tpr,
    })),
  };
};

/* --- P3 ---------------------------------------------------------------------- */

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

/** Within-person ratios by window, 100 batches, all ages (#262). */
export const readWithinPerson = (
  text: string | undefined,
): Readonly<{
  people: number;
  windows: readonly Readonly<{ window: string; ratio: Ratio }>[];
}> | null => {
  const all = parseJson(text, timingSchema)?.timing.batches001to100.find(
    (b) => b.minAgeYears === 0,
  );
  if (all === undefined || all.withinPerson.windows.length === 0) return null;
  return {
    people: all.withinPerson.people,
    windows: all.withinPerson.windows.map((w) => ({
      window: w.window,
      ratio: w.ageAdjustedMH,
    })),
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

export type RuleChange = Readonly<{
  base: Ratio & Readonly<{ expected: number }>;
  doubled: Ratio & Readonly<{ expected: number }>;
}>;

/** The rule-change test (#295). */
export const readRuleChange = (text: string | undefined): RuleChange | null => {
  const data = parseJson(text, fullHistorySchema);
  if (data === null) return null;
  const { base, afTimesTwo } = data.ruleChange;
  return {
    base: base.withinAgeAdjusted,
    doubled: {
      ratio: afTimesTwo.withinAgeAdjusted.ratio,
      low: afTimesTwo.withinAgeAdjusted.low,
      high: afTimesTwo.withinAgeAdjusted.high,
      expected: afTimesTwo.withinAgeAdjusted.expectedFactor2,
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

export type HeartBrain = Readonly<{
  date: string | null;
  /** Pairs with a ratio; a pair with too few events has none and is left out. */
  rules: readonly Readonly<{
    id: string;
    label: string;
    planted: string;
    ratio: Ratio;
  }>[];
  observed: Ratio | null;
  shuffled: Readonly<{ mean: number; low: number; high: number; runs: number }>;
}>;

/** The matched between-person study: planted rules and the shuffled-onset null. */
export const readHeartBrain = (text: string | undefined): HeartBrain | null => {
  const data = parseJson(text, heartBrainSchema);
  if (data === null) return null;
  const rules = data.study.rules.flatMap((r) =>
    r.ratio === null
      ? []
      : [
          {
            id: r.id,
            label: r.label,
            planted: r.planted,
            ratio: { ratio: r.ratio.ratio, low: r.ratio.ci.low, high: r.ratio.ci.high },
          },
        ],
  );
  const afStroke = rules.find((r) => r.id === "af-stroke");
  return {
    date: isoDay(data.generatedAt),
    rules,
    observed:
      afStroke === undefined
        ? null
        : { ...afStroke.ratio, ratio: data.study.shuffled.observedRatio },
    shuffled: data.study.shuffled.ratio,
  };
};

/* --- P4 ---------------------------------------------------------------------- */

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

export type Attack = z.infer<typeof attack>;
export type Attacks = z.infer<typeof disclosureSchema>["attacks"];

/** Membership-inference attacks per record (#301). */
export const readDisclosure = (text: string | undefined): Attacks | null =>
  parseJson(text, disclosureSchema)?.attacks ?? null;
