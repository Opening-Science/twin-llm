/**
 * Host CLI: split a conversations file into training and validation, holding
 * out whole template groups, whole LOINC codes and a share of subjects.
 *
 *   bun run training:split -- --in training-data/out/synthea-v4-seed1001.jsonl
 *   bun run training:split -- --in <file>.jsonl --seed 7 --template-share 0.1 \
 *     --code-share 0.1 --subject-share 0.02
 *
 * Reads `<base>.jsonl`, `<base>.meta.jsonl` and `<base>.manifest.json` from
 * training:conversations and writes `<base>.train.jsonl`,
 * `<base>.train.meta.jsonl`, `<base>.val.jsonl`, `<base>.val.meta.jsonl` and
 * `<base>.split.json` (what was held out, counts and stats per part). Reads
 * files only; no database. See docs/training-data.md.
 */
import { readFile, writeFile } from "node:fs/promises";

import { outputPaths } from "./build-conversations";
import { holdoutReasons, planSplit, type SplitMeta, type SplitOptions } from "./split";
import { conversationStats, messageChars, type StatsMeta } from "./stats";

export type SplitDeps = Readonly<{
  readText: (path: string) => Promise<string | null>;
  writeText: (path: string, text: string) => Promise<void>;
}>;

export type SplitIo = Readonly<{
  stdout: { write: (chunk: string) => void };
  stderr: { write: (chunk: string) => void };
}>;

export type SplitArgs = SplitOptions & Readonly<{ input: string }>;

const flag = (argv: readonly string[], name: string): string | undefined => {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
};

const shareFlag = (
  argv: readonly string[],
  name: string,
  fallback: number,
): number | string => {
  const text = flag(argv, name);
  const value = text === undefined ? fallback : Number(text);
  return Number.isFinite(value) && value >= 0 && value < 1
    ? value
    : `${name} must be a number from 0 up to (not including) 1.`;
};

export const parseSplitArgs = (argv: readonly string[]): SplitArgs | string => {
  const input = flag(argv, "--in");
  if (!input || !input.endsWith(".jsonl"))
    return "Usage: bun run training:split -- --in <conversations>.jsonl";
  const seedText = flag(argv, "--seed") ?? "1";
  const seed = Number(seedText);
  if (!Number.isInteger(seed) || seed < 0) return "--seed must be a whole number.";
  const templateShare = shareFlag(argv, "--template-share", 0.1);
  const codeShare = shareFlag(argv, "--code-share", 0.1);
  const subjectShare = shareFlag(argv, "--subject-share", 0.02);
  if (typeof templateShare === "string") return templateShare;
  if (typeof codeShare === "string") return codeShare;
  if (typeof subjectShare === "string") return subjectShare;
  return { input, seed, templateShare, codeShare, subjectShare };
};

type Meta = SplitMeta & StatsMeta;

const isMeta = (value: unknown): value is Meta => {
  const get = (key: string) => Reflect.get(Object(value), key);
  const loinc = get("measure_loinc");
  const ref = get("subject_ref");
  return (
    typeof get("family") === "string" &&
    typeof get("outcome") === "string" &&
    typeof get("template_id") === "string" &&
    typeof get("template_group") === "string" &&
    typeof get("style") === "string" &&
    typeof get("typo") === "boolean" &&
    (loinc === null || typeof loinc === "string") &&
    (ref === null || typeof ref === "string")
  );
};

const parseLine = (line: string): unknown => {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
};

const nonEmpty = (text: string): string[] =>
  text.split("\n").filter((line) => line.length > 0);

/** Paths next to the input: `x.jsonl` → `x.train.jsonl`, `x.val.meta.jsonl`, `x.split.json`. */
export const splitPaths = (input: string) => {
  const base = input.slice(0, -".jsonl".length);
  return {
    trainRecords: `${base}.train.jsonl`,
    trainMeta: `${base}.train.meta.jsonl`,
    valRecords: `${base}.val.jsonl`,
    valMeta: `${base}.val.meta.jsonl`,
    manifest: `${base}.split.json`,
  };
};

export const runSplitConversations = async (
  argv: readonly string[],
  io: SplitIo,
  deps: SplitDeps,
): Promise<number> => {
  const args = parseSplitArgs(argv);
  if (typeof args === "string") {
    io.stderr.write(`${args}\n`);
    return 1;
  }
  const paths = outputPaths(args.input);
  const [recordsText, metaText, manifestText] = await Promise.all([
    deps.readText(paths.records),
    deps.readText(paths.meta),
    deps.readText(paths.manifest),
  ]);
  if (recordsText === null || metaText === null) {
    io.stderr.write(`Cannot read ${paths.records} and ${paths.meta}.\n`);
    return 1;
  }
  const records = nonEmpty(recordsText);
  const metas = nonEmpty(metaText).map(parseLine);
  if (records.length !== metas.length || !metas.every(isMeta)) {
    io.stderr.write(
      "The records and meta files do not match line for line, or the meta lines are from an older generator (no template_id). Rebuild with training:conversations.\n",
    );
    return 1;
  }
  const typedMetas = metas.filter(isMeta);
  const plan = planSplit(typedMetas, args);
  const parts = typedMetas.map((meta, at) => ({
    meta,
    line: records[at] ?? "",
    reasons: holdoutReasons(meta, plan, args),
  }));
  const train = parts.filter((part) => part.reasons.length === 0);
  const val = parts.filter((part) => part.reasons.length > 0);
  const out = splitPaths(args.input);
  const joined = (lines: readonly string[]) =>
    lines.length === 0 ? "" : `${lines.join("\n")}\n`;
  await deps.writeText(out.trainRecords, joined(train.map((part) => part.line)));
  await deps.writeText(
    out.trainMeta,
    joined(train.map((part) => JSON.stringify(part.meta))),
  );
  await deps.writeText(out.valRecords, joined(val.map((part) => part.line)));
  await deps.writeText(
    out.valMeta,
    joined(
      val.map((part) => JSON.stringify({ ...part.meta, holdout_reasons: part.reasons })),
    ),
  );

  const tools = Reflect.get(Object(parseLine(manifestText ?? "")), "tools");
  const toolsChars = tools === undefined ? 0 : JSON.stringify(tools).length;
  const statsOf = (list: typeof parts) =>
    conversationStats(
      list.map((part) => {
        const messages = Reflect.get(Object(parseLine(part.line)), "messages");
        return {
          meta: part.meta,
          chars: messageChars(Array.isArray(messages) ? messages : []),
        };
      }),
      toolsChars,
    );
  const reasonCount = (reason: string) =>
    val.filter((part) => part.reasons.some((r) => r === reason)).length;
  await deps.writeText(
    out.manifest,
    `${JSON.stringify(
      {
        input: args.input,
        seed: args.seed,
        shares: {
          template_groups: args.templateShare,
          loinc: args.codeShare,
          subjects: args.subjectShare,
        },
        held_out: { template_groups: plan.templateGroups, loinc: plan.loinc },
        files: out,
        train: train.length,
        val: val.length,
        val_by_reason: {
          template: reasonCount("template"),
          code: reasonCount("code"),
          subject: reasonCount("subject"),
        },
        stats: { train: statsOf(train), val: statsOf(val) },
      },
      null,
      2,
    )}\n`,
  );
  io.stdout.write(
    [
      `Split ${args.input}: ${train.length} train, ${val.length} validation (${out.manifest})`,
      `Held out ${plan.templateGroups.length} template groups and ${plan.loinc.length} LOINC codes: ${plan.loinc.join(", ") || "none"}`,
      "",
    ].join("\n"),
  );
  return 0;
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  const code = await runSplitConversations(process.argv.slice(2), process, {
    readText: (path) => readFile(path, "utf8").catch(() => null),
    writeText: (path, text) => writeFile(path, text),
  });
  process.exit(code);
}
