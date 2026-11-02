/**
 * `bun run eval:agreement -- <run-id> [<run-id> …]` (#351).
 *
 * For each run: reads `evaluation/runs/<run-id>/meta.json`, `results.jsonl`
 * and every `ratings/<rater>.json` the rating view wrote, scores the run as
 * `eval:report` does, and prints Cohen's kappa with a 95 % interval for each
 * rater against the correctness scorer and for each pair of raters, pooled
 * over the runs of each question set given (#304: runs of hb and v1h are
 * reported apart, each on its own rubric, and a ratings file whose rubric is
 * not its run's set's is left out). With `--ids` it also reads each rater's
 * salt for the set (`evaluation/rater-sets/<rater>.json` for hb,
 * `evaluation/rater-sets/<set>/<rater>.json` otherwise, #355) and lists the
 * answer ids that rater's page used for the rated lines, mapped back to run,
 * item and repeat. Reads no env and no database and writes nothing.
 *
 * For v1h (#413) it compares on the protocol's review sample only
 * (`reviewSample` in `features/lab/rater-sample.ts`, the lines the rating
 * view shows) and lists the sampled lines with their scenario and
 * correctness outcome; `--all` compares on every rated line instead, for a
 * second pass. hb has no sample and is always compared on every line.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  lineKey,
  parseRatingFile,
  RATINGS_DIR,
  type RatingFile,
} from "../../features/lab/rating-file";
import { isRatedSet, rubricOf, type RatedSet } from "../../features/lab/rater-rubric";
import { reviewSample } from "../../features/lab/rater-sample";
import { parseRaterSet, raterSetFile } from "../../features/lab/rater-set";
import { EMPTY_VALUE, formatNumber } from "../../infrastructure/format-measure";
import {
  noConsentStore,
  requireLearningConsent,
} from "../../infrastructure/learning-consent";
import {
  agreementRows,
  type AnswerIdRow,
  answerIdRows,
  type Kappa,
  groupBySet,
  ratedSetForFile,
  type LineOutcome,
  restrictToLines,
  type RunAgreementInput,
  type SampledLine,
  type ScorerOutcome,
  STRATUM_OUTCOMES,
  strataRows,
} from "./agreement";
import { metaSchema, QUESTION_SETS, resultLineSchema } from "./eval-results";
import { answerKeySchema, questionSetSchema } from "./question-set";
import { reportRows, RUNS_DIR } from "./run-report";
import { scoreRun } from "./score/score-run";

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, "utf8")) as unknown;

type LoadedRun = Readonly<{
  set: string;
  input: RunAgreementInput;
  files: readonly RatingFile[];
  /** The v1h review sample of the run (#413); null for a set without one. */
  sampled: readonly SampledLine[] | null;
}>;

const loadRun = async (runId: string): Promise<LoadedRun> => {
  const dir = join(RUNS_DIR, runId);
  const meta = metaSchema.parse(await readJson(join(dir, "meta.json")));
  const permit = await requireLearningConsent(
    "evaluation",
    reportRows(meta),
    noConsentStore(),
  );
  if (!permit.ok) throw new Error(`${runId}: ${permit.message}`);
  if (meta.mock) throw new Error(`${runId}: a fake model answered this run`);
  const lines = (await readFile(join(dir, "results.jsonl"), "utf8"))
    .split("\n")
    .filter((row) => row.trim() !== "")
    .map((row) => resultLineSchema.parse(JSON.parse(row) as unknown));
  const set = meta.question_set ?? "v1";
  const files = QUESTION_SETS[set];
  const questions = questionSetSchema.parse(await readJson(files.questions));
  const key = answerKeySchema.parse(await readJson(files.key));
  const scores = scoreRun({
    models: meta.models.map((model) => ({
      provider: model.provider,
      modelId: model.model_id,
    })),
    items: questions.items,
    entries: key.entries,
    lines,
  });
  const outcomes = new Map<string, LineOutcome>(
    scores.flatMap((model) =>
      model.scored.map(
        (scored) =>
          [
            lineKey(scored.line.item_id, scored.line.repeat),
            scored.scores.correctness.score,
          ] as const,
      ),
    ),
  );
  const itemIds = new Set(questions.items.map((item) => item.id));
  const sampled =
    set === "v1h"
      ? reviewSample(
          lines
            .filter(
              (line) =>
                line.error === null &&
                line.text !== null &&
                !line.mock &&
                itemIds.has(line.item_id),
            )
            .map((line) => ({
              runId,
              itemId: line.item_id,
              repeat: line.repeat,
              scenario: line.scenario,
              outcome: outcomes.get(lineKey(line.item_id, line.repeat)) ?? "unscored",
            })),
        )
      : null;
  const scorer = new Map<string, ScorerOutcome>(
    scores.flatMap((model) =>
      model.scored.flatMap((scored) => {
        const outcome = scored.scores.correctness.score;
        return outcome === "pass" || outcome === "fail"
          ? [[lineKey(scored.line.item_id, scored.line.repeat), outcome] as const]
          : [];
      }),
    ),
  );
  const names = await readdir(join(dir, RATINGS_DIR)).catch(() => [] as string[]);
  const raters = new Map<string, ReadonlyMap<string, number>>();
  const rated: RatingFile[] = [];
  for (const name of names.filter((each) => each.endsWith(".json")).sort()) {
    const file = parseRatingFile(await readFile(join(dir, RATINGS_DIR, name), "utf8"));
    if (file === null || file.run_id !== runId) {
      process.stderr.write(
        `${runId}: ${name} is not a ratings file of this run; left out\n`,
      );
      continue;
    }
    if (ratedSetForFile(set, file.rubric) === null) {
      process.stderr.write(
        `${runId}: ${name} is rated on ${file.rubric}, not the rubric of set ${set}; left out\n`,
      );
      continue;
    }
    rated.push(file);
    raters.set(
      file.rater,
      new Map(
        file.ratings.map((rating) => [
          lineKey(rating.item_id, rating.repeat),
          rating.level,
        ]),
      ),
    );
  }
  return { set, input: { runId, scorer, raters }, files: rated, sampled };
};

/** The rater's salt for the set, or null when this machine has no readable rater set for them. */
const saltOf = async (rated: RatedSet, rater: string): Promise<string | null> => {
  const text = await readFile(raterSetFile(rated, rater), "utf8").catch(() => null);
  const found = text === null ? null : parseRaterSet(text);
  return found !== null && found.rater === rater ? found.salt : null;
};

const answerIds = async (
  set: RatedSet,
  runs: readonly LoadedRun[],
): Promise<{ rows: AnswerIdRow[]; missing: string[] }> => {
  const files = runs.flatMap((run) => run.files);
  const raters = [...new Set(files.map((file) => file.rater))].sort();
  const salts = new Map(
    await Promise.all(
      raters.map(async (rater) => [rater, await saltOf(set, rater)] as const),
    ),
  );
  return {
    rows: files
      .flatMap((file) => {
        const salt = salts.get(file.rater);
        return salt === null || salt === undefined
          ? []
          : answerIdRows(file.rater, salt, file.run_id, file.ratings);
      })
      .sort((a, b) => a.rater.localeCompare(b.rater) || a.id.localeCompare(b.id)),
    missing: raters.filter((rater) => salts.get(rater) === null),
  };
};

const number = (value: number | null): string =>
  value === null ? EMPTY_VALUE : formatNumber(value, 2);

const kappaText = (result: Kappa | null): string[] =>
  result === null
    ? ["0", EMPTY_VALUE, "no lines in common"]
    : [
        String(result.n),
        number(result.observed),
        result.kappa === null
          ? "not defined (one category only)"
          : result.low === null
            ? `${number(result.kappa)} (no interval: one side used one category)`
            : `${number(result.kappa)} (${number(result.low)} to ${number(result.high)})`,
      ];

/** The comparison of one run: on its review sample, or on every line with `--all` or no sample. */
const compared = (run: LoadedRun, everyLine: boolean): RunAgreementInput =>
  run.sampled === null || everyLine
    ? run.input
    : restrictToLines(
        run.input,
        new Set(run.sampled.map((line) => lineKey(line.itemId, line.repeat))),
      );

const writeSample = (runs: readonly LoadedRun[], everyLine: boolean): void => {
  const lines = runs.flatMap((run) => run.sampled ?? []);
  process.stdout.write(
    everyLine
      ? `Compared on every rated line (--all); the review sample (${lines.length} lines) is listed for reference.\n\n`
      : `Compared on the review sample: ${lines.length} lines (v1h-review.v1).\n\n`,
  );
  process.stdout.write(
    `| Scenario | ${STRATUM_OUTCOMES.join(" | ")} | Lines |\n|${" --- |".repeat(STRATUM_OUTCOMES.length + 2)}\n`,
  );
  for (const row of strataRows(lines)) {
    process.stdout.write(
      `| ${[row.scenario, ...STRATUM_OUTCOMES.map((outcome) => String(row.counts[outcome])), String(row.total)].join(" | ")} |\n`,
    );
  }
  process.stdout.write(
    "\n| Run | Item | Repeat | Scenario | Correctness |\n| --- | --- | --- | --- | --- |\n",
  );
  for (const line of lines) {
    process.stdout.write(
      `| ${[line.runId, line.itemId, String(line.repeat), line.scenario, line.outcome].join(" | ")} |\n`,
    );
  }
  process.stdout.write("\n");
};

const FLAGS = new Set(["--", "--ids", "--all"]);

const main = async (argv: readonly string[]): Promise<number> => {
  const withIds = argv.includes("--ids");
  const everyLine = argv.includes("--all");
  const runIds = argv.filter((arg) => !FLAGS.has(arg));
  if (runIds.length === 0 || runIds.some((id) => !RUN_ID.test(id))) {
    process.stderr.write(
      "Usage: bun run eval:agreement -- [--ids] [--all] <run-id> [<run-id> …]\n",
    );
    return 2;
  }
  const loaded = await Promise.all(runIds.map(loadRun));
  process.stdout.write(`Runs: ${runIds.join(", ")}\n`);
  for (const [set, runs] of groupBySet(loaded)) {
    process.stdout.write(`\n## Set ${set}\n\n`);
    if (runs.some((run) => run.sampled !== null)) writeSample(runs, everyLine);
    const rows = agreementRows(runs.map((run) => compared(run, everyLine)));
    const rated = isRatedSet(set) ? set : null;
    if (rows.length === 0) {
      process.stdout.write("No ratings found in these runs.\n");
      continue;
    }
    if (rated !== null) process.stdout.write(`Rubric: ${rubricOf(rated).version}\n\n`);
    process.stdout.write(
      "| Comparison | Lines | Observed agreement | Kappa (95 % CI) |\n| --- | --- | --- | --- |\n",
    );
    for (const row of rows) {
      process.stdout.write(
        `| ${[row.comparison, ...kappaText(row.result)].join(" | ")} |\n`,
      );
    }
    if (withIds && rated !== null) {
      const ids = await answerIds(rated, runs);
      process.stdout.write(
        "\n| Rater | Answer id | Run | Item | Repeat |\n| --- | --- | --- | --- | --- |\n",
      );
      for (const row of ids.rows) {
        process.stdout.write(
          `| ${[row.rater, row.id, row.runId, row.itemId, String(row.repeat)].join(" | ")} |\n`,
        );
      }
      for (const rater of ids.missing) {
        process.stderr.write(
          `${rater}: no rater set at ${raterSetFile(rated, rater)}; that rater's answer ids cannot be mapped\n`,
        );
      }
    }
  }
  return 0;
};

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
