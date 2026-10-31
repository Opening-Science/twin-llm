/**
 * `bun run eval:agreement -- <run-id> [<run-id> …]` (#351).
 *
 * For each run: reads `evaluation/runs/<run-id>/meta.json`, `results.jsonl`
 * and every `ratings/<rater>.json` the rating view wrote, scores the run as
 * `eval:report` does, and prints Cohen's kappa with a 95 % interval for each
 * rater against the correctness scorer and for each pair of raters, pooled
 * over the runs given. With `--ids` it also reads each rater's salt from
 * `evaluation/rater-sets/<rater>.json` (#355) and lists the answer ids that
 * rater's page used for the rated lines, mapped back to run, item and
 * repeat. Reads no env and no database and writes nothing.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  lineKey,
  parseRatingFile,
  RATINGS_DIR,
  type RatingFile,
} from "../../features/lab/rating-file";
import { parseRaterSet } from "../../features/lab/rater-set";
import { EMPTY_VALUE, formatNumber } from "../../infrastructure/format-measure";
import {
  noConsentStore,
  requireLearningConsent,
} from "../../infrastructure/learning-consent";
import { RATER_SETS_DIR } from "../../infrastructure/local-artefacts";

import {
  agreementRows,
  type AnswerIdRow,
  answerIdRows,
  type Kappa,
  type RunAgreementInput,
  type ScorerOutcome,
} from "./agreement";
import { metaSchema, QUESTION_SETS, resultLineSchema } from "./eval-results";
import { answerKeySchema, questionSetSchema } from "./question-set";
import { reportRows, RUNS_DIR } from "./run-report";
import { scoreRun } from "./score/score-run";

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, "utf8")) as unknown;

type LoadedRun = Readonly<{ input: RunAgreementInput; files: readonly RatingFile[] }>;

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
  const files = QUESTION_SETS[meta.question_set ?? "v1"];
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
  return { input: { runId, scorer, raters }, files: rated };
};

/** The rater's salt, or null when this machine has no readable rater set for them. */
const saltOf = async (rater: string): Promise<string | null> => {
  const text = await readFile(join(RATER_SETS_DIR, `${rater}.json`), "utf8").catch(
    () => null,
  );
  const set = text === null ? null : parseRaterSet(text);
  return set !== null && set.rater === rater ? set.salt : null;
};

const answerIds = async (
  runs: readonly LoadedRun[],
): Promise<{ rows: AnswerIdRow[]; missing: string[] }> => {
  const files = runs.flatMap((run) => run.files);
  const raters = [...new Set(files.map((file) => file.rater))].sort();
  const salts = new Map(
    await Promise.all(raters.map(async (rater) => [rater, await saltOf(rater)] as const)),
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

const main = async (argv: readonly string[]): Promise<number> => {
  const withIds = argv.includes("--ids");
  const runIds = argv.filter((arg) => arg !== "--" && arg !== "--ids");
  if (runIds.length === 0 || runIds.some((id) => !RUN_ID.test(id))) {
    process.stderr.write(
      "Usage: bun run eval:agreement -- [--ids] <run-id> [<run-id> …]\n",
    );
    return 2;
  }
  const loaded = await Promise.all(runIds.map(loadRun));
  const rows = agreementRows(loaded.map((run) => run.input));
  if (rows.length === 0) {
    process.stdout.write("No ratings found in these runs.\n");
    return 0;
  }
  process.stdout.write(
    `Runs: ${runIds.join(", ")}\n\n| Comparison | Lines | Observed agreement | Kappa (95 % CI) |\n| --- | --- | --- | --- |\n`,
  );
  for (const row of rows) {
    process.stdout.write(
      `| ${[row.comparison, ...kappaText(row.result)].join(" | ")} |\n`,
    );
  }
  if (withIds) {
    const ids = await answerIds(loaded);
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
        `${rater}: no rater set in ${RATER_SETS_DIR}; that rater's answer ids cannot be mapped\n`,
      );
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
