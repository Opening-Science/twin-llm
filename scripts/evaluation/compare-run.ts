/**
 * `bun run eval:compare -- <run-a> <run-b> [<run-a> <run-b> …] [--unit item|line] [--json]`.
 *
 * For each pair of runs: reads `evaluation/runs/<run-id>/meta.json` and
 * `results.jsonl`, scores both with the current scorers as `eval:report`
 * does, pairs them item by item (repeats folded by majority; `--unit line`
 * pairs each repeat instead, a sensitivity analysis), and prints the exact
 * McNemar test per criterion with Holm's adjustment within the pair and,
 * as a sensitivity column, across every pair given (`compare.ts`).
 * Markdown by default; `--json` prints one JSON document for every pair.
 * Reads no env and no database, calls no model and writes nothing.
 *
 * It refuses a pair, printing nothing, when a run is MOCK, has more than one
 * model, needs a consent this file-only command cannot check, does not share
 * one questions sha256 with the current questions and key, or the two runs
 * did not ask the same questions (question set and questions sha256).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  type LearningGateDeps,
  noConsentStore,
  requireLearningConsent,
} from "../../infrastructure/learning-consent";

import { questionsSha256 } from "./build-answer-key";
import {
  compareRuns,
  type CriterionComparison,
  familyHolm,
  isUnit,
  renderComparison,
  runOutcomes,
  toItemOutcomes,
  type Unit,
} from "./compare";
import {
  metaSchema,
  type QuestionSetId,
  QUESTION_SETS,
  type RunMeta,
  resultLineSchema,
} from "./eval-results";
import { answerKeySchema, questionSetSchema } from "./question-set";
import { ReportError, reportRows, RUNS_DIR } from "./run-report";
import { scoreRun } from "./score/score-run";

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

const USAGE =
  "bun run eval:compare -- <run-a> <run-b> [<run-a> <run-b> …] [--unit item|line] [--json]";

export type CompareDeps = Readonly<{
  readText: (path: string) => Promise<string>;
  learning: LearningGateDeps;
}>;

export type CompareIo = Readonly<{
  stdout: { write: (chunk: string) => void };
  stderr: { write: (chunk: string) => void };
}>;

export type RunSide = Readonly<{
  run_id: string;
  model_id: string;
  arm: string;
  git_sha: string;
  date: string;
}>;

export type PairResult = Readonly<{
  a: RunSide;
  b: RunSide;
  question_set: QuestionSetId;
  questions_sha256: string;
  unit: Unit;
  criteria: readonly CriterionComparison[];
}>;

type LoadedRun = Readonly<{
  meta: RunMeta;
  set: QuestionSetId;
  outcomes: ReturnType<typeof runOutcomes>;
}>;

const parseArgs = (argv: readonly string[]) => {
  const args = argv.filter((arg) => arg !== "--");
  const json = args.includes("--json");
  const flag = args.indexOf("--unit");
  const unitArg = flag === -1 ? "item" : args[flag + 1];
  if (unitArg === undefined || !isUnit(unitArg)) {
    throw new ReportError("USAGE", USAGE);
  }
  const runs = args.filter(
    (arg, index) =>
      arg !== "--json" && (flag === -1 || (index !== flag && index !== flag + 1)),
  );
  if (
    runs.length === 0 ||
    runs.length % 2 !== 0 ||
    runs.some((run) => !RUN_ID.test(run))
  ) {
    throw new ReportError("USAGE", USAGE);
  }
  const pairs = runs.flatMap((run, index) =>
    index % 2 === 0 ? [[run, runs[index + 1] ?? ""] as const] : [],
  );
  return { json, unit: unitArg, pairs };
};

const loadRun = async (deps: CompareDeps, runId: string): Promise<LoadedRun> => {
  const dir = join(RUNS_DIR, runId);
  const readJson = async (path: string) =>
    JSON.parse(await deps.readText(path)) as unknown;
  const meta = metaSchema.parse(await readJson(join(dir, "meta.json")));
  const permit = await requireLearningConsent(
    "evaluation",
    reportRows(meta),
    deps.learning,
  );
  if (!permit.ok) throw new ReportError(permit.code, `${runId}: ${permit.message}`);
  if (meta.mock) {
    throw new ReportError("MOCK_RUN", `${runId}: a fake model answered this run`);
  }
  const [model, ...others] = meta.models;
  if (model === undefined || others.length > 0) {
    throw new ReportError("ONE_MODEL", `${runId}: a run to compare must have one model`);
  }
  const lines = (await deps.readText(join(dir, "results.jsonl")))
    .split("\n")
    .filter((row) => row.trim() !== "")
    .map((row) => resultLineSchema.parse(JSON.parse(row) as unknown));
  if (lines.some((line) => line.mock)) {
    throw new ReportError("MOCK_RUN", `${runId}: a line came from a fake model`);
  }
  // A run written before #251 names no set: it ran v1.
  const set = meta.question_set ?? "v1";
  const files = QUESTION_SETS[set];
  const questionsRaw = await readJson(files.questions);
  const questions = questionSetSchema.parse(questionsRaw);
  const key = answerKeySchema.parse(await readJson(files.key));
  const sha = questionsSha256(questionsRaw);
  if (sha !== key.questions_sha256 || sha !== meta.questions_sha256) {
    throw new ReportError(
      "QUESTIONS_SHA_MISMATCH",
      `${runId}: the questions, the answer key and the run do not share one questions sha256`,
    );
  }
  const [scores] = scoreRun({
    models: [{ provider: model.provider, modelId: model.model_id }],
    items: questions.items,
    entries: key.entries,
    lines,
  });
  if (scores === undefined)
    throw new ReportError("ONE_MODEL", `${runId}: nothing scored`);
  const mine = lines.filter(
    (line) => line.provider === model.provider && line.model_id === model.model_id,
  );
  return {
    meta,
    set,
    outcomes: runOutcomes({ items: questions.items, lines: mine, scored: scores.scored }),
  };
};

const sideOf = (meta: RunMeta): RunSide => ({
  run_id: meta.run_id,
  model_id: meta.models[0]?.model_id ?? "",
  arm: meta.arm ?? "tools",
  git_sha: meta.git_sha,
  date: meta.date,
});

export const comparePair = async (
  deps: CompareDeps,
  runA: string,
  runB: string,
  unit: Unit = "item",
): Promise<PairResult> => {
  const [a, b] = await Promise.all([loadRun(deps, runA), loadRun(deps, runB)]);
  if (a.set !== b.set || a.meta.questions_sha256 !== b.meta.questions_sha256) {
    throw new ReportError(
      "NOT_PAIRED",
      `${runA} (${a.set}) and ${runB} (${b.set}) did not ask the same questions`,
    );
  }
  return {
    a: sideOf(a.meta),
    b: sideOf(b.meta),
    question_set: a.set,
    questions_sha256: a.meta.questions_sha256,
    unit,
    criteria:
      unit === "item"
        ? compareRuns(toItemOutcomes(a.outcomes), toItemOutcomes(b.outcomes))
        : compareRuns(a.outcomes, b.outcomes),
  };
};

const renderPair = (pair: PairResult): string =>
  [
    `## ${pair.a.run_id} (A) against ${pair.b.run_id} (B)`,
    "",
    `Set ${pair.question_set}, unit ${pair.unit}. A: ${pair.a.model_id}, ${pair.a.arm}, git ${pair.a.git_sha.slice(0, 7)}. B: ${pair.b.model_id}, ${pair.b.arm}, git ${pair.b.git_sha.slice(0, 7)}.`,
    "",
    renderComparison(pair.criteria),
    "",
  ].join("\n");

export const runCompare = async (
  argv: readonly string[],
  io: CompareIo,
  deps: CompareDeps,
): Promise<number> => {
  try {
    const { json, unit, pairs } = parseArgs(argv);
    const compared: PairResult[] = [];
    for (const [runA, runB] of pairs) {
      compared.push(await comparePair(deps, runA, runB, unit));
    }
    const family = familyHolm(compared.map((pair) => pair.criteria));
    const results = compared.map((pair, index) => ({
      ...pair,
      criteria: family[index] ?? pair.criteria,
    }));
    io.stdout.write(
      json
        ? `${JSON.stringify(results, null, 2)}\n`
        : `${results.map(renderPair).join("\n")}`,
    );
    return 0;
  } catch (error) {
    if (error instanceof ReportError) {
      io.stderr.write(`${error.message}\n`);
      return 1;
    }
    io.stderr.write(
      `The comparison stopped: a run file did not parse (${error instanceof Error ? error.name : "unknown"}).\n`,
    );
    return 1;
  }
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  const code = await runCompare(process.argv.slice(2), process, {
    readText: (path) => readFile(path, "utf8"),
    learning: noConsentStore(),
  });
  process.exit(code);
}
