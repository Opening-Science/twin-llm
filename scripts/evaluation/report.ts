/**
 * Renders a scored run: `report.md`, the blinded `review.csv` and the
 * label mapping in `review-key.json`. Pure; `run-report.ts` reads and writes.
 *
 * The report and the sheet never include a tool output: the sheet holds the
 * question, the model's reply, the item's notes and the scorers' reasons, and
 * the reasons name values and the model's own numbers only. Raw tool results
 * stay in the gitignored `results.jsonl`.
 */
import { formatNumber } from "../../infrastructure/format-measure";

import { sha256Hex } from "../../packages/audit/hash";

import type { RunMeta } from "./eval-results";
import { SCENARIOS, type Scenario, V1_SCENARIOS } from "./question-set";
import {
  type LatencyFigures,
  type ModelKey,
  modelName,
  type ModelScores,
  SCORED_CRITERIA,
  type ScoredCriterion,
  type ScoredLine,
  sumTallies,
  type Tally,
} from "./score/score-run";
import { wilson95 } from "./score/stats";

const DASH = "—";

const short = (sha: string): string => sha.slice(0, 12);

const percent = (fraction: number): string => `${formatNumber(fraction * 100, 0)} %`;

/** `3/4 (30–95 %)`: passes over pass + fail, with the Wilson 95 % interval. */
export const scoreCell = (tally: Tally): string => {
  const n = tally.pass + tally.fail;
  const interval = wilson95(tally.pass, n);
  if (!interval) return DASH;
  return `${tally.pass}/${n} (${formatNumber(interval.low * 100, 0)}–${formatNumber(interval.high * 100, 0)} %)`;
};

const seconds = (ms: number | null): string =>
  ms === null ? DASH : `${formatNumber(ms / 1000, 1)} s`;

const table = (header: readonly string[], rows: readonly (readonly string[])[]): string =>
  [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");

const isEmpty = (tally: Tally): boolean =>
  tally.pass + tally.fail + tally.human + tally.na + tally.error === 0;

/**
 * The scenario columns: the v1 scenarios always, so a v1 report keeps its
 * shape, and a later one (S7) only when the run scored a line in it.
 */
export const reportScenarios = (scores: ModelScores): Scenario[] =>
  SCENARIOS.filter(
    (scenario) =>
      (V1_SCENARIOS as readonly Scenario[]).includes(scenario) ||
      Object.values(scores.tallies).some((byScenario) => !isEmpty(byScenario[scenario])),
  );

const criterionAll = (scores: ModelScores, criterion: ScoredCriterion): Tally =>
  sumTallies(SCENARIOS.map((scenario: Scenario) => scores.tallies[criterion][scenario]));

const overview = (all: readonly ModelScores[]): string =>
  table(
    [
      "Model",
      "Lines",
      "Answered",
      "Errors",
      "Error rate",
      "Skipped (MISSING_ENV)",
      "Cache hits",
    ],
    all.map((scores) => {
      const ran = scores.lines - scores.skipped;
      return [
        modelName(scores.model),
        String(scores.lines),
        String(scores.answered),
        String(scores.errors),
        ran === 0 ? DASH : percent(scores.errors / ran),
        String(scores.skipped),
        String(scores.cacheHits),
      ];
    }),
  );

const scoreTable = (scores: ModelScores): string => {
  const scenarios = reportScenarios(scores);
  return table(
    ["Criterion", ...scenarios, "All"],
    SCORED_CRITERIA.map((criterion) => [
      criterion,
      ...scenarios.map((scenario) => scoreCell(scores.tallies[criterion][scenario])),
      scoreCell(criterionAll(scores, criterion)),
    ]),
  );
};

const notScoredTable = (scores: ModelScores): string =>
  table(
    ["Criterion", "Human", "Human share", "n/a", "Error"],
    SCORED_CRITERIA.map((criterion) => {
      const all = criterionAll(scores, criterion);
      const judged = all.pass + all.fail + all.human;
      return [
        criterion,
        String(all.human),
        judged === 0 ? DASH : percent(all.human / judged),
        String(all.na),
        String(all.error),
      ];
    }),
  );

const latencyRow = (name: string, set: string, figures: LatencyFigures): string[] => [
  name,
  set,
  String(figures.n),
  seconds(figures.ttft.p50),
  seconds(figures.ttft.p90),
  seconds(figures.ttft.p95),
  seconds(figures.total.p50),
  seconds(figures.total.p90),
  seconds(figures.total.p95),
];

const latencyTable = (all: readonly ModelScores[]): string =>
  table(
    [
      "Model",
      "Set",
      "n",
      "TTFT p50",
      "TTFT p90",
      "TTFT p95",
      "Total p50",
      "Total p90",
      "Total p95",
    ],
    all.flatMap((scores) => [
      latencyRow(modelName(scores.model), "latency set", scores.latency.latencySet),
      latencyRow(modelName(scores.model), "all items", scores.latency.overall),
    ]),
  );

/** Answers hallucination scored, the unsourced numbers in them, and how many had any. */
export const unsourcedFigures = (
  scores: Readonly<{ scored: readonly Pick<ScoredLine, "unsourcedNumbers">[] }>,
): Readonly<{ answers: number; numbers: number; withAny: number }> => {
  const counts = scores.scored.flatMap((entry) =>
    entry.unsourcedNumbers === null ? [] : [entry.unsourcedNumbers],
  );
  return {
    answers: counts.length,
    numbers: counts.reduce((sum, n) => sum + n, 0),
    withAny: counts.filter((n) => n > 0).length,
  };
};

const unsourcedTable = (all: readonly ModelScores[]): string =>
  table(
    ["Model", "Answers", "Unsourced numbers", "Per answer", "Answers with any"],
    all.map((scores) => {
      const figures = unsourcedFigures(scores);
      return [
        modelName(scores.model),
        String(figures.answers),
        String(figures.numbers),
        figures.answers === 0 ? DASH : formatNumber(figures.numbers / figures.answers, 2),
        String(figures.withAny),
      ];
    }),
  );

export type ReportInput = Readonly<{
  meta: RunMeta;
  scores: readonly ModelScores[];
  /** Not in meta.json and not reported by vLLM, so the person running the report gives it. */
  quantisation: string | null;
}>;

export const renderReport = ({ meta, scores, quantisation }: ReportInput): string => {
  const hostOf = (model: ModelKey): string =>
    meta.models.find(
      (entry) => entry.provider === model.provider && entry.model_id === model.modelId,
    )?.host ?? "not recorded";
  return [
    `# Eval report ${meta.run_id}`,
    "",
    table(
      ["Run", "Value"],
      [
        ["Date", meta.date],
        ["Git", short(meta.git_sha)],
        ["Questions sha256", short(meta.questions_sha256)],
        ["Answer key sha256", short(meta.answer_key_sha256)],
        ["Cohort", meta.cohort_id],
        ["open-twin", short(meta.open_twin_sha)],
        ["Replay", meta.replay ? "yes" : "no"],
        ["Sampling", meta.sampling],
        ["Platform", meta.platform],
      ],
    ),
    "",
    "## Overview",
    "",
    overview(scores),
    "",
    "Error rate is errors over the lines that ran; skipped lines are left out. An error is never a pass.",
    "",
    ...scores.flatMap((model) => [
      `## Scores: ${modelName(model.model)}`,
      "",
      "Passes over scored answers (pass + fail), with the Wilson 95 % interval. Human, n/a and error counts are in the next table and never count as passes.",
      "",
      scoreTable(model),
      "",
      `### Not scored automatically: ${modelName(model.model)}`,
      "",
      "Human share is human over pass + fail + human. A high share means the pass rate rests on few answers.",
      "",
      notScoredTable(model),
      "",
    ]),
    "## Latency",
    "",
    "Seconds, nearest-rank percentiles. Cache hits and errors are left out.",
    "",
    latencyTable(scores),
    "",
    "## Unsourced numbers",
    "",
    "Numbers in a reply that neither a tool call of the turn nor the question gives, dates and 0 to 10 left out: the numbers the app shows without a link. Counted over the answers hallucination scores. An extra metric; no pass or fail depends on it.",
    "",
    unsourcedTable(scores),
    "",
    "## Limits",
    "",
    `- The questions were written alongside the ${meta.cohort_id} cohort they are scored against, so these results lean optimistic.`,
    ...scores.map(
      (model) =>
        `- ${modelName(model.model)}: quantisation ${quantisation ?? "not recorded"}, host ${hostOf(model.model)}, platform ${meta.platform}.`,
    ),
    "- Numbers are matched by a heuristic. A miss counts as human, not fail, so read the human share next to each pass rate.",
    "- Consistency counts once per item and model. Latency is not pass/fail.",
    "- The review sheet (review.csv) is scored by a person and is not in these tables.",
    "",
  ].join("\n");
};

/** "Model A", "Model B", … ordered by a hash of run and model, so order gives nothing away. */
export const blindLabels = (
  runId: string,
  models: readonly ModelKey[],
): Map<string, string> =>
  new Map(
    [...models]
      .map((model) => ({
        name: modelName(model),
        hash: sha256Hex(`${runId}|${modelName(model)}`),
      }))
      .sort((a, b) => a.hash.localeCompare(b.hash, "en"))
      .map((entry, index) => [entry.name, `Model ${String.fromCharCode(65 + index)}`]),
  );

export const REVIEW_COLUMNS = [
  "label",
  "item_id",
  "repeat",
  "scenario",
  "question",
  "answer",
  "human_note",
  "flags",
  "must_not_checklist",
  "readability_1_5",
  "clinical_caution_pass_fail",
  "comment",
] as const;

/** A spreadsheet runs a cell starting with these as a formula; a leading `'` stops it. */
const FORMULA_START = /^[=+\-@\t\r]/;

export const csvCell = (raw: string): string => {
  const value = FORMULA_START.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
};

/** One row per answered line: every answer needs the readability rubric. */
export const renderReviewSheet = (
  runId: string,
  scores: readonly ModelScores[],
): string => {
  const labels = blindLabels(
    runId,
    scores.map((model) => model.model),
  );
  const rows = scores
    .flatMap((model) =>
      model.scored.map((entry) => {
        const flags = SCORED_CRITERIA.flatMap((criterion) => {
          const result = entry.scores[criterion];
          return result.score === "fail" || result.score === "human"
            ? [`${criterion} ${result.score}: ${result.reasons.join("; ")}`]
            : [];
        });
        return {
          label: labels.get(modelName(model.model)) ?? "",
          cells: [
            labels.get(modelName(model.model)) ?? "",
            entry.item.id,
            String(entry.line.repeat),
            entry.item.scenario,
            entry.item.question,
            entry.line.text ?? "",
            entry.item.human,
            flags.join(" | "),
            entry.item.expect.must_not.join(" | "),
            "",
            "",
            "",
          ],
        };
      }),
    )
    .sort(
      (a, b) =>
        (a.cells[1] ?? "").localeCompare(b.cells[1] ?? "", "en") ||
        Number(a.cells[2]) - Number(b.cells[2]) ||
        a.label.localeCompare(b.label, "en"),
    );
  return `${[REVIEW_COLUMNS.join(","), ...rows.map((row) => row.cells.map(csvCell).join(","))].join("\n")}\n`;
};

export const renderReviewKey = (
  runId: string,
  scores: readonly ModelScores[],
): string => {
  const labels = blindLabels(
    runId,
    scores.map((model) => model.model),
  );
  return `${JSON.stringify(
    {
      run_id: runId,
      note: "Keep this file away from reviewers until review.csv is filled in.",
      labels: Object.fromEntries(
        [...labels.entries()].map(([name, label]) => [label, name]),
      ),
    },
    null,
    2,
  )}\n`;
};
