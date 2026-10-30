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
import { CALL_CLASSES, type CallClass, callReasons } from "./score/call-accuracy";
import {
  PAIR_OUTCOMES,
  type PairOutcome,
  pairReason,
  type PairRepeat,
} from "./score/decline-pairs";
import {
  NO_TOOL_KINDS,
  type NoToolKind,
  noToolReason,
  withoutTool,
} from "./score/no-tool-values";
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

/** `3/40 (3–20 %)`: a share of lines with the Wilson 95 % interval. */
export const shareCell = (count: number, n: number): string => {
  const interval = wilson95(count, n);
  if (!interval) return DASH;
  return `${count}/${n} (${formatNumber(interval.low * 100, 0)}–${formatNumber(interval.high * 100, 0)} %)`;
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

const countBy = <K extends string>(
  keys: readonly K[],
  count: (key: K) => number,
): Readonly<Record<K, number>> =>
  Object.fromEntries(keys.map((key) => [key, count(key)])) as Record<K, number>;

export type CallFigures = Readonly<{
  /** Answered lines of items with answer-key entries. */
  answers: number;
  allRight: number;
  noCall: number;
  /** Lines with at least one call of the class. */
  lines: Readonly<Record<CallClass, number>>;
  /** Calls of the class. */
  calls: Readonly<Record<CallClass, number>>;
}>;

export const callFigures = (
  scores: Readonly<{ scored: readonly Pick<ScoredLine, "calls">[] }>,
): CallFigures => {
  const all = scores.scored.flatMap((entry) =>
    entry.calls === null ? [] : [entry.calls],
  );
  return {
    answers: all.length,
    allRight: all.filter((entry) => entry.allRight).length,
    noCall: all.filter((entry) => entry.noCall).length,
    lines: countBy(
      CALL_CLASSES,
      (cls) =>
        all.filter((entry) => entry.calls.some((call) => call.class === cls)).length,
    ),
    calls: countBy(
      CALL_CLASSES,
      (cls) =>
        all.flatMap((entry) => entry.calls).filter((call) => call.class === cls).length,
    ),
  };
};

export type NoToolFigures = Readonly<{
  /** Answered lines of items that read subject data. */
  answers: number;
  /** No call or no rows: a value with no reading behind it. */
  withoutTool: number;
  kinds: Readonly<Record<NoToolKind, number>>;
}>;

export const noToolFigures = (
  scores: Readonly<{ scored: readonly Pick<ScoredLine, "noTool">[] }>,
): NoToolFigures => {
  const all = scores.scored.flatMap((entry) =>
    entry.noTool === null ? [] : [entry.noTool],
  );
  return {
    answers: all.length,
    withoutTool: all.filter(withoutTool).length,
    kinds: countBy(
      NO_TOOL_KINDS,
      (kind) => all.filter((entry) => entry.kind === kind).length,
    ),
  };
};

const LINE_CLASSES: readonly CallClass[] = CALL_CLASSES.filter(
  (cls) => cls !== "right call",
);

const callLinesTable = (all: readonly ModelScores[]): string =>
  table(
    ["Model", "Answers", "All right", "No call", ...LINE_CLASSES.map((cls) => cls)],
    all.map((scores) => {
      const figures = callFigures(scores);
      return [
        modelName(scores.model),
        String(figures.answers),
        shareCell(figures.allRight, figures.answers),
        shareCell(figures.noCall, figures.answers),
        ...LINE_CLASSES.map((cls) => shareCell(figures.lines[cls], figures.answers)),
      ];
    }),
  );

const callCountsTable = (all: readonly ModelScores[]): string =>
  table(
    ["Model", "Calls", ...CALL_CLASSES.map((cls) => cls)],
    all.map((scores) => {
      const figures = callFigures(scores);
      const total = CALL_CLASSES.reduce((sum, cls) => sum + figures.calls[cls], 0);
      return [
        modelName(scores.model),
        String(total),
        ...CALL_CLASSES.map((cls) => String(figures.calls[cls])),
      ];
    }),
  );

const noToolTable = (all: readonly ModelScores[]): string =>
  table(
    ["Model", "Answers", "Without a tool", ...NO_TOOL_KINDS.map((kind) => kind)],
    all.map((scores) => {
      const figures = noToolFigures(scores);
      return [
        modelName(scores.model),
        String(figures.answers),
        shareCell(figures.withoutTool, figures.answers),
        ...NO_TOOL_KINDS.map((kind) => shareCell(figures.kinds[kind], figures.answers)),
      ];
    }),
  );

export type PairFigures = Readonly<{
  /** Pair repeats with both sides answered. */
  pairs: number;
  outcomes: Readonly<Record<PairOutcome, number>>;
  /** Good pairs whose control also passed correctness. */
  goodControlCorrect: number;
  /** Pair repeats where one side errored or has no such repeat. */
  unpaired: number;
}>;

export const pairFigures = (
  scores: Readonly<{ pairs: readonly PairRepeat[] }>,
): PairFigures => {
  const paired = scores.pairs.filter((pair) => pair.outcome !== null);
  return {
    pairs: paired.length,
    outcomes: countBy(
      PAIR_OUTCOMES,
      (outcome) => paired.filter((pair) => pair.outcome === outcome).length,
    ),
    goodControlCorrect: paired.filter(
      (pair) => pair.outcome === "good" && pair.controlCorrectness === "pass",
    ).length,
    unpaired: scores.pairs.length - paired.length,
  };
};

const pairTable = (all: readonly ModelScores[]): string =>
  table(
    [
      "Model",
      "Pairs",
      ...PAIR_OUTCOMES.map((outcome) => outcome),
      "good, control correct",
      "Unpaired",
    ],
    all.map((scores) => {
      const figures = pairFigures(scores);
      return [
        modelName(scores.model),
        String(figures.pairs),
        ...PAIR_OUTCOMES.map((outcome) =>
          shareCell(figures.outcomes[outcome], figures.pairs),
        ),
        shareCell(figures.goodControlCorrect, figures.pairs),
        String(figures.unpaired),
      ];
    }),
  );

const pairSection = (all: readonly ModelScores[]): string[] =>
  all.some((scores) => scores.pairs.length > 0)
    ? [
        "## Decline pairs",
        "",
        "Items sharing a `pair-NN` tag: a decline and an answerable control on the same subject, scored together per repeat. Good: the decline declined and the control answered. Over-decline: both declined. Missed decline: both answered. Both wrong: the decline answered and the control declined. Declined is the clinical caution test (`declined_decision_support`). Good, control correct: good pairs whose control also passed correctness. Repeats are paired by number; unpaired counts a repeat only one side has or where either side errored. Shares of the pairs with the Wilson 95 % interval. An extra metric; no pass or fail depends on it.",
        "",
        pairTable(all),
        "",
      ]
    : [];

export type ReportInput = Readonly<{
  meta: RunMeta;
  scores: readonly ModelScores[];
  /** Not in meta.json and not reported by vLLM, so the person running the report gives it. */
  quantisation: string | null;
  /** How many cohort codes call accuracy checked against; null when none were loaded. */
  cohortCodes?: number | null;
}>;

export const renderReport = ({
  meta,
  scores,
  quantisation,
  cohortCodes = null,
}: ReportInput): string => {
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
        [
          "Cohort codes",
          cohortCodes === null
            ? "not loaded: invented code is the check digit only"
            : `${cohortCodes} (evaluation/cohort-codes.v1.json)`,
        ],
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
    "## Tool calls against the key",
    "",
    "Each tool call of an answer to an item with answer-key entries, compared with the calls the key reads: its code, subject and window. A line counts in a column when at least one of its calls has that class. All right: at least one right call and no wrong code, invented code, wrong subject or wrong window; extra calls are allowed. Shares of those answers with the Wilson 95 % interval. An extra metric beside the eight criteria; no pass or fail depends on it.",
    "",
    callLinesTable(scores),
    "",
    "Calls by class:",
    "",
    callCountsTable(scores),
    "",
    "## Answers without a tool",
    "",
    "Answers to items that read subject data which state a value (a number with a unit, or after a measure name) that neither the question nor any tool result of the turn holds. Without a tool: the turn called no tool (no call) or no call returned a reading (no rows). Not in rows: calls returned readings but none holds the value; the model may have derived it. Shares with the Wilson 95 % interval. An extra metric; no pass or fail depends on it.",
    "",
    noToolTable(scores),
    "",
    ...pairSection(scores),
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
        const flags = [
          ...SCORED_CRITERIA.flatMap((criterion) => {
            const result = entry.scores[criterion];
            return result.score === "fail" || result.score === "human"
              ? [`${criterion} ${result.score}: ${result.reasons.join("; ")}`]
              : [];
          }),
          ...(entry.calls === null || entry.calls.allRight
            ? []
            : [`calls: ${callReasons(entry.calls).join("; ")}`]),
          ...(entry.noTool === null || entry.noTool.kind === null
            ? []
            : [noToolReason(entry.noTool)]),
          ...model.pairs.flatMap((pair) => {
            const reason =
              pair.repeat === entry.line.repeat &&
              (pair.declineId === entry.item.id || pair.controlId === entry.item.id)
                ? pairReason(pair)
                : null;
            return reason === null ? [] : [reason];
          }),
        ];
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
