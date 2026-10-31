/**
 * `bun run eval:agreement -- <run-id> [<run-id> …]` (#351).
 *
 * For each run: reads `evaluation/runs/<run-id>/meta.json`, `results.jsonl`
 * and every `ratings/<rater>.json` the rating view wrote, scores the run as
 * `eval:report` does, and prints Cohen's kappa with a 95 % interval for each
 * rater against the correctness scorer and for each pair of raters, pooled
 * over the runs given. Reads no env and no database and writes nothing.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { lineKey, parseRatingFile, RATINGS_DIR } from "../../features/lab/rating-file";
import { EMPTY_VALUE, formatNumber } from "../../infrastructure/format-measure";
import {
  noConsentStore,
  requireLearningConsent,
} from "../../infrastructure/learning-consent";

import {
  agreementRows,
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

const loadRun = async (runId: string): Promise<RunAgreementInput> => {
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
  for (const name of names.filter((each) => each.endsWith(".json")).sort()) {
    const file = parseRatingFile(await readFile(join(dir, RATINGS_DIR, name), "utf8"));
    if (file === null || file.run_id !== runId) {
      process.stderr.write(
        `${runId}: ${name} is not a ratings file of this run; left out\n`,
      );
      continue;
    }
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
  return { runId, scorer, raters };
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
  const runIds = argv.filter((arg) => arg !== "--");
  if (runIds.length === 0 || runIds.some((id) => !RUN_ID.test(id))) {
    process.stderr.write("Usage: bun run eval:agreement -- <run-id> [<run-id> …]\n");
    return 2;
  }
  const runs = await Promise.all(runIds.map(loadRun));
  const rows = agreementRows(runs);
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
  return 0;
};

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
