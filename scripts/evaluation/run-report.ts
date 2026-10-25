/**
 * `bun run eval:report -- <run-id> [--quantisation <text>]`.
 *
 * Reads `evaluation/runs/<run-id>/results.jsonl` and `meta.json`, scores every
 * line, and writes `report.md`, `review.csv` and `review-key.json` next to them.
 * Reads no env and no database: a replayed run reports the same anywhere.
 *
 * It refuses, writing nothing, when:
 * - the run is MOCK (a fake model answered): that tests the harness, not a model;
 * - a line is results v1 (no tool results): replay the run to upgrade it;
 * - the questions, the key and the run disagree on the questions' sha256;
 * - the report text would contain a claim-lint stem (it may be committed under docs/).
 *
 * The Markdown goes through Prettier, so a report committed under docs/ passes
 * `format:check` and the pre-commit hook leaves it byte for byte as written.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { BANNED_TERMS } from "../lint-claims";

import { questionsSha256 } from "./build-answer-key";
import {
  ANSWER_KEY_PATH,
  metaSchema,
  QUESTIONS_PATH,
  RESULTS_SCHEMA_VERSION,
  type ResultLine,
  resultLineSchema,
} from "./eval-results";
import { answerKeySchema, questionSetSchema } from "./question-set";
import { renderReport, renderReviewKey, renderReviewSheet } from "./report";
import { scoreRun } from "./score/score-run";

export const RUNS_DIR = "evaluation/runs";

export class ReportError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "ReportError";
  }
}

export type ReportDeps = Readonly<{
  readText: (path: string) => Promise<string>;
  writeText: (path: string, text: string) => Promise<void>;
}>;

export type ReportIo = Readonly<{
  stdout: { write: (chunk: string) => void };
  stderr: { write: (chunk: string) => void };
}>;

const parseArgs = (argv: readonly string[]) => {
  const args = argv.filter((arg) => arg !== "--");
  const flag = args.indexOf("--quantisation");
  const quantisation = flag === -1 ? null : (args[flag + 1] ?? null);
  if (flag !== -1 && (quantisation === null || quantisation.startsWith("--"))) {
    throw new ReportError("USAGE", "--quantisation needs a value");
  }
  const positional = args.filter(
    (arg, index) => !arg.startsWith("--") && (flag === -1 || index !== flag + 1),
  );
  const runId = positional[0];
  if (
    runId === undefined ||
    positional.length > 1 ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(runId)
  ) {
    throw new ReportError(
      "USAGE",
      "bun run eval:report -- <run-id> [--quantisation <text>]",
    );
  }
  return { runId, quantisation };
};

const parseLines = (jsonl: string): ResultLine[] =>
  jsonl
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      const raw = JSON.parse(line) as unknown;
      const version =
        typeof raw === "object" && raw !== null
          ? Reflect.get(raw, "schema_version")
          : null;
      if (version !== RESULTS_SCHEMA_VERSION) {
        throw new ReportError(
          "RESULTS_VERSION",
          `line ${index + 1} is ${String(version)}, not ${RESULTS_SCHEMA_VERSION}; replay the run (bun run eval -- … --replay) to upgrade it`,
        );
      }
      return resultLineSchema.parse(raw);
    });

export const formatMarkdown = async (markdown: string, path: string): Promise<string> => {
  const prettier = await import("prettier");
  const options = await prettier.resolveConfig(path);
  return prettier.format(markdown, { ...options, parser: "markdown" });
};

const stemsIn = (text: string): string[] =>
  BANNED_TERMS.filter((term) => new RegExp(term.source, "i").test(text)).map(
    (term) => term.id,
  );

export const runReport = async (
  argv: readonly string[],
  io: ReportIo,
  deps: ReportDeps,
): Promise<number> => {
  try {
    const { runId, quantisation } = parseArgs(argv);
    const dir = join(RUNS_DIR, runId);
    const meta = metaSchema.parse(
      JSON.parse(await deps.readText(join(dir, "meta.json"))) as unknown,
    );
    if (meta.mock) {
      throw new ReportError(
        "MOCK_RUN",
        "a fake model answered this run; it tests the harness and is not a result",
      );
    }
    const lines = parseLines(await deps.readText(join(dir, "results.jsonl")));
    if (lines.some((line) => line.mock)) {
      throw new ReportError(
        "MOCK_RUN",
        "a line came from a fake model; it is not a result",
      );
    }

    const questionsRaw = JSON.parse(await deps.readText(QUESTIONS_PATH)) as unknown;
    const questions = questionSetSchema.parse(questionsRaw);
    const key = answerKeySchema.parse(
      JSON.parse(await deps.readText(ANSWER_KEY_PATH)) as unknown,
    );
    const sha = questionsSha256(questionsRaw);
    if (sha !== key.questions_sha256 || sha !== meta.questions_sha256) {
      throw new ReportError(
        "QUESTIONS_SHA_MISMATCH",
        "the questions, the answer key and the run do not share one questions sha256",
      );
    }

    const scores = scoreRun({
      models: meta.models.map((model) => ({
        provider: model.provider,
        modelId: model.model_id,
      })),
      items: questions.items,
      entries: key.entries,
      lines,
    });
    const markdown = await formatMarkdown(
      renderReport({ meta, scores, quantisation }),
      join(dir, "report.md"),
    );
    const stems = stemsIn(markdown);
    if (stems.length > 0) {
      throw new ReportError(
        "REPORT_CLAIM_STEM",
        `report text contains ${stems.join(", ")}`,
      );
    }

    await deps.writeText(join(dir, "report.md"), markdown);
    await deps.writeText(join(dir, "review.csv"), renderReviewSheet(runId, scores));
    await deps.writeText(join(dir, "review-key.json"), renderReviewKey(runId, scores));
    io.stdout.write(
      `Wrote ${dir}/report.md, review.csv and review-key.json (${lines.length} lines, ${scores.length} models)\n`,
    );
    return 0;
  } catch (error) {
    if (error instanceof ReportError) {
      io.stderr.write(`${error.message}\n`);
      return 1;
    }
    io.stderr.write(
      `The report stopped: a run file did not parse (${error instanceof Error ? error.name : "unknown"}).\n`,
    );
    return 1;
  }
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  const code = await runReport(process.argv.slice(2), process, {
    readText: (path) => readFile(path, "utf8"),
    writeText: (path, text) => writeFile(path, text),
  });
  process.exit(code);
}
