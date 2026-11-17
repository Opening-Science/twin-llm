/**
 * Host CLI for the source-attribution study (P6, #508).
 *
 *   bun run attribution:study -- --items .attribution-study/dev-seed6509/items.json --model fake:first_listed
 *   bun run attribution:study -- --items <items.json> --model ollama:qwen3:4b --repeats 3 --counterfactual
 *   bun run attribution:study -- --report <records.jsonl>
 *
 * Runs every item (and, with --counterfactual, its variants) under the
 * conditions asked for (default C0,C1,C2), writes one JSON line per answer
 * to `records.jsonl` as it lands and the report to `report.md`, both in
 * --out (default: beside the items, `run-<model>`). `--report` only
 * rewrites the report from a records file. A model is `fake:<policy>` or
 * `ollama:<tag>` on this machine; nothing leaves it. The items are synthetic;
 * the run reads no person's data and has no path to a database.
 */
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type { W1Item } from "../../synthetic-wearables/w1-items";
import { type Condition, CONDITIONS } from "./contexts";
import { studyItems } from "./counterfactual";
import { studyReport } from "./report";
import {
  type AnswerModel,
  FAKE_POLICIES,
  fakeModel,
  ollamaModel,
  runStudy,
  type StudyRecord,
  studyCells,
} from "./run";

const flag = (argv: readonly string[], name: string): string | undefined => {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
};

export const modelFor = (spec: string): AnswerModel | string => {
  if (spec.startsWith("fake:")) {
    const policy = spec.slice(5);
    return (FAKE_POLICIES as readonly string[]).includes(policy)
      ? fakeModel(policy as (typeof FAKE_POLICIES)[number])
      : `fake policies: ${FAKE_POLICIES.join(", ")}.`;
  }
  if (spec.startsWith("ollama:") && spec.length > 7) return ollamaModel(spec.slice(7));
  return "--model is fake:<policy> or ollama:<tag>.";
};

export type StudyArgs =
  | Readonly<{ kind: "report"; records: string }>
  | Readonly<{
      kind: "run";
      items: string;
      model: AnswerModel;
      conditions: readonly Condition[];
      repeats: number;
      counterfactual: boolean;
      out: string;
    }>;

export const parseStudyArgs = (argv: readonly string[]): StudyArgs | string => {
  const report = flag(argv, "--report");
  if (report !== undefined) return { kind: "report", records: report };
  const items = flag(argv, "--items");
  if (items === undefined) return "--items <items.json> is required.";
  const model = modelFor(flag(argv, "--model") ?? "");
  if (typeof model === "string") return model;
  const conditions = (flag(argv, "--conditions") ?? CONDITIONS.join(",")).split(",");
  if (!conditions.every((c) => (CONDITIONS as readonly string[]).includes(c))) {
    return `--conditions takes ${CONDITIONS.join(", ")}.`;
  }
  const repeats = Number(flag(argv, "--repeats") ?? 1);
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) {
    return "--repeats must be a whole number from 1 to 10.";
  }
  return {
    kind: "run",
    items,
    model,
    conditions: conditions as Condition[],
    repeats,
    counterfactual: argv.includes("--counterfactual"),
    out:
      flag(argv, "--out") ??
      join(dirname(items), `run-${model.id.replace(/[^a-z0-9.-]+/gi, "-")}`),
  };
};

const readRecords = (text: string): readonly StudyRecord[] =>
  text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as StudyRecord);

const reportMeta = (records: readonly StudyRecord[]) => ({
  title: "Source attribution study",
  items: String(new Set(records.map((record) => record.baseItemId)).size),
});

export type StudyIo = Readonly<{
  stdout: { write: (chunk: string) => void };
  stderr: { write: (chunk: string) => void };
}>;

export const runStudyCli = async (
  argv: readonly string[],
  io: StudyIo,
): Promise<number> => {
  const args = parseStudyArgs(argv);
  if (typeof args === "string") {
    io.stderr.write(`${args}\n`);
    return 1;
  }
  if (args.kind === "report") {
    const records = readRecords(await readFile(resolve(args.records), "utf8"));
    const target = join(dirname(resolve(args.records)), "report.md");
    await writeFile(target, studyReport(records, reportMeta(records)));
    io.stdout.write(`Report written to ${target} from ${records.length} records\n`);
    return 0;
  }
  const file = JSON.parse(await readFile(resolve(args.items), "utf8")) as {
    testData?: unknown;
    items?: readonly W1Item[];
  };
  if (file.testData !== true || !Array.isArray(file.items)) {
    io.stderr.write("--items must be a W1 items file written by attribution:w1.\n");
    return 1;
  }
  const out = resolve(args.out);
  await mkdir(out, { recursive: true });
  const recordsPath = join(out, "records.jsonl");
  await writeFile(recordsPath, "");
  const cells = studyCells(studyItems(file.items, args.counterfactual), args.conditions);
  const records = await runStudy({
    cells,
    models: [args.model],
    repeats: args.repeats,
    onRecord: (record) => appendFile(recordsPath, `${JSON.stringify(record)}\n`),
  });
  await writeFile(join(out, "report.md"), studyReport(records, reportMeta(records)));
  const errors = records.filter((record) => record.error !== null).length;
  io.stdout.write(
    `${records.length} answers from ${args.model.id} (${errors} errors) written to ${out}\n`,
  );
  return 0;
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) process.exit(await runStudyCli(process.argv.slice(2), process));
