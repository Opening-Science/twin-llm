/**
 * Host CLI: the hb tally (#293) over one or more eval runs.
 *
 *   bun run eval:hb-verdicts -- <run-id> [<run-id> …]
 *
 * Reads `evaluation/runs/<run-id>/results.jsonl`, the hb questions and their
 * key; prints one Markdown table row per model and, per answered line of a
 * verdict item, the verdict phrases it used. Reads no env and no database.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { QUESTION_SETS, resultLineSchema } from "./eval-results";
import { tallyHb } from "./hb-verdicts";
import { answerKeySchema, questionSetSchema } from "./question-set";
import { statedVerdicts } from "./score/verdict-match";

const main = async (runIds: readonly string[]): Promise<number> => {
  if (runIds.length === 0) {
    process.stderr.write("Usage: bun run eval:hb-verdicts -- <run-id> [<run-id> …]\n");
    return 2;
  }
  const questions = questionSetSchema.parse(
    JSON.parse(await readFile(QUESTION_SETS.hb.questions, "utf8")) as unknown,
  );
  const key = answerKeySchema.parse(
    JSON.parse(await readFile(QUESTION_SETS.hb.key, "utf8")) as unknown,
  );
  const lines = [];
  for (const runId of runIds) {
    const text = await readFile(join("evaluation/runs", runId, "results.jsonl"), "utf8");
    lines.push(
      ...text
        .split("\n")
        .filter((row) => row.trim() !== "")
        .map((row) => resultLineSchema.parse(JSON.parse(row) as unknown)),
    );
  }
  const header =
    "| Model | Verdict lines | Match scripted | Match planted | No verdict phrase | Invented relations | Called the tool | Refusal items called the tool | Declined | Decline items with a tool call | Errors |";
  process.stdout.write(`${header}\n|${" --- |".repeat(11)}\n`);
  for (const row of tallyHb(lines, questions.items, key.entries)) {
    process.stdout.write(
      `| ${row.model} | ${row.verdictLines} | ${row.matchesScripted} | ${row.matchesPlanted} | ${row.noVerdictPhrase} | ${row.inventedRelations} | ${row.calledTool} | ${row.refusalCalledTool} of ${row.refusalLines} | ${row.declined} of ${row.declineLines} | ${row.declineCalledTool} | ${row.errors} |\n`,
    );
  }
  process.stdout.write("\n");
  for (const line of lines) {
    process.stdout.write(
      `${line.model_id} ${line.item_id} r${line.repeat}: ${line.error ?? (statedVerdicts(line.text ?? "").join(", ") || "-")} [${line.tool_results.map((result) => result.tool).join(", ")}] ${line.document?.answer_class ?? ""}\n`,
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
