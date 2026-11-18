/**
 * The source-attribution study's report (P6 section 9.1, #508): per model,
 * condition and stratum, each answer-level outcome as a share with the Wilson
 * 95% interval; number-level citation precision and recall; and the
 * counterfactual tests, pairing each C1 answer with its variant of the same
 * model and repeat. Pure: records in, Markdown out.
 *
 * Harness errors count as failures (`n` includes them). Shares are
 * descriptive; the registered tests (mixed models, cluster bootstrap) are
 * run on the same records by the analysis scripts.
 */
import { wilson95 } from "../score/stats";
import { type AnalysisOptions, contrastsMarkdown, outcomeOf, partA } from "./analysis";
import type { Condition } from "./contexts";
import type { StudyRecord } from "./run";
import { NUMBER_VERDICTS, type NumberVerdict, type StudyScore } from "./score";

type Outcome = Readonly<{
  label: string;
  field: keyof Pick<
    StudyScore,
    | "attributionCorrect"
    | "disagreementHandled"
    | "overHedged"
    | "dayCorrect"
    | "abstentionCorrect"
    | "constructHandled"
  >;
}>;

export const OUTCOMES: readonly Outcome[] = [
  { label: "Attribution correct (H1)", field: "attributionCorrect" },
  { label: "Disagreement handled (H2a)", field: "disagreementHandled" },
  { label: "Over-hedged (H2b)", field: "overHedged" },
  { label: "Day correct", field: "dayCorrect" },
  { label: "Abstention correct", field: "abstentionCorrect" },
  { label: "Construct mismatch handled", field: "constructHandled" },
];

export type Share = Readonly<{
  hits: number;
  n: number;
  share: number | null;
  low: number | null;
  high: number | null;
}>;

export const shareOf = (hits: number, n: number): Share => {
  const interval = wilson95(hits, n);
  return {
    hits,
    n,
    share: n === 0 ? null : hits / n,
    low: interval?.low ?? null,
    high: interval?.high ?? null,
  };
};

/**
 * An outcome over the records it applies to; an error counts as a failure
 * (for over-hedging, a failure is `true`). Attribution is scored where a
 * right answer states a number (the expected outcome is `state`); every
 * other outcome on its own stratum.
 */
export const outcomeShare = (
  records: readonly StudyRecord[],
  outcome: Outcome,
): Share => {
  const stratum = OUTCOME_STRATUM[outcome.field];
  const applies = records.filter((record) =>
    stratum === null ? record.expected.kind === "state" : record.stratum === stratum,
  );
  return shareOf(
    applies.filter((record) => outcomeOf(record, outcome.field)).length,
    applies.length,
  );
};

const OUTCOME_STRATUM: Readonly<Record<Outcome["field"], StudyRecord["stratum"] | null>> =
  {
    attributionCorrect: null,
    disagreementHandled: "disagree",
    overHedged: "agree",
    dayCorrect: "day_shift",
    abstentionCorrect: "missing",
    constructHandled: "construct_mismatch",
  };

export type NumberRates = Readonly<{
  counts: Readonly<Record<NumberVerdict, number>>;
  /** Correct over numbers whose citation names a cell of their measure. */
  precision: Share;
  /** Correct over numbers that trace to a cell. */
  recall: Share;
}>;

export const numberRates = (records: readonly StudyRecord[]): NumberRates => {
  const numbers = records.flatMap((record) => record.score?.numbers ?? []);
  const counts = Object.fromEntries(
    NUMBER_VERDICTS.map((verdict) => [
      verdict,
      numbers.filter((number) => number.verdict === verdict).length,
    ]),
  ) as Record<NumberVerdict, number>;
  const correct = counts.correct;
  const withCitation = numbers.filter(
    (number) => number.verdict !== "uncited" && number.verdict !== "untraced",
  ).length;
  const traced = numbers.filter((number) => number.verdict !== "untraced").length;
  return {
    counts,
    precision: shareOf(correct, withCitation),
    recall: shareOf(correct, traced),
  };
};

/**
 * The counterfactual tests, each over C1 base answers paired with their
 * variant (same model, item and repeat). The rule swap is over citation-
 * correct base answers (H3); the value tests over base answers that stated
 * the expected reading, cited, since the variant moves that reading or
 * another one.
 */
export type Faithfulness = Readonly<{
  /** The swapped rule's answer did not state the source that rule picks. */
  ruleSwapFailure: Share;
  /** The variant still stated the expected reading, at its new value. */
  valueFollows: Share;
  /** The variant still stated the expected reading when another source moved. */
  valueStays: Share;
}>;

const pairKey = (record: StudyRecord): string =>
  `${record.model}|${record.baseItemId}|${record.repeat}`;

const expectedSource = (record: StudyRecord) =>
  record.expected.kind === "state" ? record.expected.source : null;

const statesExpected = (record: StudyRecord): boolean =>
  record.expected.kind === "state" &&
  (record.score?.numbers.some(
    (number) =>
      number.key === (record.expected.kind === "state" ? record.expected.key : "") &&
      number.verdict === "correct",
  ) ??
    false);

export const faithfulness = (records: readonly StudyRecord[]): Faithfulness => {
  const baseWhere = (keep: (record: StudyRecord) => boolean): ReadonlySet<string> =>
    new Set(
      records
        .filter(
          (record) =>
            record.variant === "base" && record.condition === "C1" && keep(record),
        )
        .map(pairKey),
    );
  const citationCorrect = baseWhere(
    (record) => record.score?.attributionCorrect === true,
  );
  const statedRight = baseWhere(statesExpected);
  const variants = (variant: StudyRecord["variant"], base: ReadonlySet<string>) =>
    records.filter((record) => record.variant === variant && base.has(pairKey(record)));
  const swaps = variants("rule_swap", citationCorrect);
  const follows = variants("perturb_cited", statedRight);
  const stays = variants("perturb_other", statedRight);
  return {
    ruleSwapFailure: shareOf(
      swaps.filter(
        (record) =>
          record.score === null || record.score.stated !== expectedSource(record),
      ).length,
      swaps.length,
    ),
    valueFollows: shareOf(follows.filter(statesExpected).length, follows.length),
    valueStays: shareOf(stays.filter(statesExpected).length, stays.length),
  };
};

const percent = (value: number | null): string =>
  value === null ? "–" : `${(value * 100).toFixed(1)}%`;

export const shareCell = (share: Share): string =>
  share.n === 0
    ? "–"
    : `${share.hits}/${share.n} ${percent(share.share)} [${percent(share.low)}, ${percent(share.high)}]`;

const group = <K extends string>(
  records: readonly StudyRecord[],
  key: (record: StudyRecord) => K,
): ReadonlyMap<K, readonly StudyRecord[]> => {
  const out = new Map<K, StudyRecord[]>();
  for (const record of records) {
    const id = key(record);
    out.set(id, [...(out.get(id) ?? []), record]);
  }
  return out;
};

export const studyReport = (
  records: readonly StudyRecord[],
  meta: Readonly<{
    title: string;
    items: string;
    note?: string;
    /** The registered contrasts' bootstrap settings; false leaves the section out. */
    analysis?: AnalysisOptions | false;
  }>,
): string => {
  const base = records.filter((record) => record.variant === "base");
  const errors = records.filter((record) => record.error !== null).length;
  const lines: string[] = [
    `# ${meta.title}`,
    "",
    `Items: ${meta.items}. Records: ${records.length} (${base.length} base, ${records.length - base.length} counterfactual); harness errors: ${errors}, counted as failures.`,
    ...(meta.note === undefined ? [] : ["", meta.note]),
    "",
    "Shares with the Wilson 95% interval. Descriptive only: the registered tests run on the same records.",
  ];
  for (const [model, ofModel] of group(base, (record) => record.model)) {
    lines.push(
      "",
      `## ${model}`,
      "",
      "| Outcome | " + conditionsOf(ofModel).join(" | ") + " |",
    );
    lines.push(
      `| --- | ${conditionsOf(ofModel)
        .map(() => "---")
        .join(" | ")} |`,
    );
    const byCondition = group(ofModel, (record) => record.condition);
    for (const outcome of OUTCOMES) {
      lines.push(
        `| ${outcome.label} | ${conditionsOf(ofModel)
          .map((condition) =>
            shareCell(outcomeShare(byCondition.get(condition) ?? [], outcome)),
          )
          .join(" | ")} |`,
      );
    }
    for (const [label, pick] of [
      ["Citation precision", (rates: NumberRates) => rates.precision],
      ["Citation recall", (rates: NumberRates) => rates.recall],
    ] as const) {
      lines.push(
        `| ${label} | ${conditionsOf(ofModel)
          .map((condition) =>
            shareCell(pick(numberRates(byCondition.get(condition) ?? []))),
          )
          .join(" | ")} |`,
      );
    }
    lines.push("", "Number verdicts, all conditions:", "");
    const counts = numberRates(ofModel).counts;
    lines.push(
      `| ${NUMBER_VERDICTS.join(" | ")} |`,
      `| ${NUMBER_VERDICTS.map(() => "---").join(" | ")} |`,
      `| ${NUMBER_VERDICTS.map((verdict) => counts[verdict]).join(" | ")} |`,
    );
    const faithful = faithfulness(records.filter((record) => record.model === model));
    lines.push(
      "",
      "Counterfactual reruns, C1, each paired with its base answer: the rule swap over citation-correct answers, the value tests over answers that stated the expected reading.",
      "",
      "| Test | Share |",
      "| --- | --- |",
      `| Rule-swap failure (H3) | ${shareCell(faithful.ruleSwapFailure)} |`,
      `| Number follows the cited reading | ${shareCell(faithful.valueFollows)} |`,
      `| Number stays when another source moves | ${shareCell(faithful.valueStays)} |`,
    );
  }
  if (meta.analysis !== false) {
    lines.push("", ...contrastsMarkdown(partA(records, meta.analysis)));
  }
  return `${lines.join("\n")}\n`;
};

const conditionsOf = (records: readonly StudyRecord[]): readonly Condition[] =>
  (["C0", "C1", "C2"] as const).filter((condition) =>
    records.some((record) => record.condition === condition),
  );
