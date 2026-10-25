/**
 * Host CLI: training conversations for safe tool use, from a synthetic cohort.
 *
 *   bun run training:conversations -- --cohort synthea-v4-seed4242
 *   bun run training:conversations -- --cohort synthea-v4-seed4242 --out training-data/out/train.jsonl \
 *     --seed 4242 --anchor 2026-10-01 --max-subjects 500 --families trend,coverage --inline-tools
 *
 * Writes `<out>.jsonl` (messages only; tools too with --inline-tools),
 * `<out>.meta.jsonl` (one meta record per line, same order) and
 * `<out>.manifest.json` (counts and the tool definitions). Both JSONL files
 * are written as `.partial` and renamed only when the run finishes.
 *
 * `.env.training` (gitignored) is a copy of `.env.synthetic.example` with
 * DATABASE_URL at a database that holds only the training (or held-out)
 * cohort; the script never loads `.env.local`. Every number in an answer comes
 * from the closed, audited query tools (actor `training-conversations`), never
 * from a model. It refuses the evaluation cohort unless `--allow-eval-cohort`
 * (smoke runs only). Prints counts only, never values. See docs/training-data.md.
 */
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { isAllowedCohort } from "../../packages/query-tools/scope";
import { subjectWindowInput } from "../../packages/query-tools/schemas";
import { KEYED_TOOLS } from "../evaluation/question-set";
import {
  COHORT_PRESETS,
  EVALUATION_COHORT_IDS,
  SYNTHEA_1M_BATCH_COHORTS,
} from "../synthea/cohort-presets";
import { stableUuid } from "../synthetic-wearables/bundle";
import { randomFor } from "../synthetic-wearables/random";
import { DEFAULT_END_DAY } from "../synthetic-wearables/series";

import {
  GENERATOR_VERSION,
  queryToolsOnlyPrompt,
  type SystemPrompt,
  toConversation,
  toolSchemas,
} from "./conversation";
import { draftsFor, type Family, FAMILIES, type ToolName } from "./families";

export const TRAINING_ACTOR = "training-conversations";

export type ConversationPorts = Readonly<{
  /** Every synthetic subject_ref in the cohort, sorted. */
  listSubjects: (cohortId: string) => Promise<readonly string[]>;
  /** One audited query tool call; returns the tool's result or refusal. */
  runTool: (name: ToolName, args: unknown) => Promise<unknown>;
  systemPrompt: () => Promise<SystemPrompt>;
}>;

export type LineWriter = Readonly<{
  write: (line: string) => Promise<void>;
  close: () => Promise<void>;
}>;

export type BuildIo = Readonly<{
  stdout: { write: (chunk: string) => void };
  stderr: { write: (chunk: string) => void };
}>;

export type BuildDeps = Readonly<{
  dataMode: () => string;
  ports: () => Promise<ConversationPorts>;
  openOut: (path: string) => Promise<LineWriter>;
  writeText: (path: string, text: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  remove: (path: string) => Promise<void>;
}>;

const TOOL_INPUTS = { ...KEYED_TOOLS, subject_window: subjectWindowInput } as const;

export type BuildArgs = Readonly<{
  cohortId: string;
  out: string;
  seed: number;
  anchorDay: string;
  maxSubjects: number | null;
  families: ReadonlySet<Family>;
  allowEvalCohort: boolean;
  inlineTools: boolean;
}>;

/** `x.jsonl` → `x.meta.jsonl`, `x.manifest.json`. */
export const outputPaths = (out: string) => {
  const base = out.endsWith(".jsonl") ? out.slice(0, -".jsonl".length) : out;
  return {
    records: out,
    meta: `${base}.meta.jsonl`,
    manifest: `${base}.manifest.json`,
  };
};

const flag = (argv: readonly string[], name: string): string | undefined => {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
};

/** The seed of a preset or 1M batch cohort; a batch cohort is named by its seed. */
const presetSeed = (cohortId: string): number | null =>
  [...Object.values(COHORT_PRESETS), ...SYNTHEA_1M_BATCH_COHORTS].find(
    (cohort) => cohort.cohortId === cohortId,
  )?.seed ?? null;

const isFamily = (name: string): name is Family =>
  (FAMILIES as readonly string[]).includes(name);

/** The parsed flags, or a plain message saying what is wrong. */
export const parseBuildArgs = (argv: readonly string[]): BuildArgs | string => {
  const cohortId = flag(argv, "--cohort");
  if (!cohortId)
    return "Usage: bun run training:conversations -- --cohort <id> [--out <file>]";
  const seedText = flag(argv, "--seed");
  const seed = seedText === undefined ? presetSeed(cohortId) : Number(seedText);
  if (seed === null || !Number.isInteger(seed) || seed < 0) {
    return "--seed must be a whole number (no preset seed for this cohort).";
  }
  const anchorDay = flag(argv, "--anchor") ?? DEFAULT_END_DAY;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorDay))
    return "--anchor must be a date like 2026-10-01.";
  const maxText = flag(argv, "--max-subjects");
  const maxSubjects = maxText === undefined ? null : Number(maxText);
  if (maxSubjects !== null && !(Number.isInteger(maxSubjects) && maxSubjects >= 1)) {
    return "--max-subjects must be a whole number of at least 1.";
  }
  const names = (flag(argv, "--families") ?? FAMILIES.join(",")).split(",");
  const unknown = names.filter((name) => !isFamily(name));
  if (unknown.length > 0) return `Unknown families: ${unknown.join(", ")}.`;
  return {
    cohortId,
    out: flag(argv, "--out") ?? `training-data/out/${cohortId}.jsonl`,
    seed,
    anchorDay,
    maxSubjects,
    families: new Set(names.filter(isFamily)),
    allowEvalCohort: argv.includes("--allow-eval-cohort"),
    inlineTools: argv.includes("--inline-tools"),
  };
};

/** A UUID-shaped subject_ref that is not in the cohort. */
const outsideRefFor = (
  seed: number,
  subjectRef: string,
  known: ReadonlySet<string>,
): string => {
  const candidate = stableUuid(`outside:${seed}:${subjectRef}`);
  return known.has(candidate) ? stableUuid(`outside:${seed}:${subjectRef}:2`) : candidate;
};

export type BuildSummary = Readonly<{
  subjects: number;
  conversations: number;
  byFamily: Readonly<Record<string, number>>;
  byOutcome: Readonly<Record<string, number>>;
}>;

const countBy = (values: readonly string[]): Record<string, number> =>
  Object.fromEntries(
    [...new Set(values)]
      .sort()
      .map((key) => [key, values.filter((v) => v === key).length]),
  );

export const runBuildConversations = async (
  argv: readonly string[],
  io: BuildIo,
  deps: BuildDeps,
): Promise<number> => {
  if (deps.dataMode() !== "synthetic") {
    io.stderr.write("training:conversations runs only with DATA_MODE=synthetic.\n");
    return 1;
  }
  const args = parseBuildArgs(argv);
  if (typeof args === "string") {
    io.stderr.write(`${args}\n`);
    return 1;
  }
  if (!isAllowedCohort(args.cohortId)) {
    io.stderr.write(`Cohort "${args.cohortId}" is not an allowed synthetic cohort.\n`);
    return 1;
  }
  if (EVALUATION_COHORT_IDS.includes(args.cohortId) && !args.allowEvalCohort) {
    io.stderr.write(
      `Cohort "${args.cohortId}" is the evaluation cohort; training on it would leak the test set. Use synthea-v4-seed4242 (pass --allow-eval-cohort for a smoke run only).\n`,
    );
    return 1;
  }

  const ports = await deps.ports();
  const prompt = queryToolsOnlyPrompt(await ports.systemPrompt());
  const all = await ports.listSubjects(args.cohortId);
  if (all.length === 0) {
    io.stderr.write(`No subjects in cohort ${args.cohortId}.\n`);
    return 1;
  }
  const subjects = args.maxSubjects === null ? all : all.slice(0, args.maxSubjects);
  const known = new Set(all);
  const run = async (name: ToolName, toolArgs: unknown) =>
    ports.runTool(name, TOOL_INPUTS[name].parse(toolArgs));

  const paths = outputPaths(args.out);
  const partial = (path: string) => `${path}.partial`;
  const records = await deps.openOut(partial(paths.records));
  const metas = await deps.openOut(partial(paths.meta));
  const families: string[] = [];
  const outcomes: string[] = [];
  const wearableStart = Date.parse(`${args.anchorDay}T00:00:00Z`) - 89 * 86_400_000;
  try {
    // One subject at a time, so the audit chain reads in subject order.
    for (const subjectRef of subjects) {
      // A planning read, not part of any conversation: a subject whose records
      // end before the wearable window has no series (deceased subjects).
      const window = await run("subject_window", { subject_ref: subjectRef });
      const end = Reflect.get(Object(window), "end");
      const hasWearables = typeof end === "string" && Date.parse(end) >= wearableStart;
      const drafts = await draftsFor(
        {
          subjectRef,
          anchorDay: args.anchorDay,
          outsideRef: outsideRefFor(args.seed, subjectRef, known),
          hasWearables,
          run,
        },
        (family) => randomFor(args.seed, `conversation:${subjectRef}:${family}`),
        args.families,
      );
      for (const draft of drafts) {
        const record = toConversation(draft, {
          cohortId: args.cohortId,
          seed: args.seed,
          prompt,
        });
        const clean = args.inlineTools
          ? { messages: record.messages, tools: record.tools }
          : { messages: record.messages };
        await records.write(`${JSON.stringify(clean)}\n`);
        await metas.write(`${JSON.stringify(record.meta)}\n`);
        families.push(draft.family);
        outcomes.push(draft.outcome);
      }
    }
  } catch {
    await records.close();
    await metas.close();
    await deps.remove(partial(paths.records));
    await deps.remove(partial(paths.meta));
    io.stderr.write(
      "Conversations stopped: a tool call failed or its arguments did not validate. Nothing was kept.\n",
    );
    return 1;
  }
  await records.close();
  await metas.close();
  await deps.rename(partial(paths.records), paths.records);
  await deps.rename(partial(paths.meta), paths.meta);

  const summary: BuildSummary = {
    subjects: subjects.length,
    conversations: families.length,
    byFamily: countBy(families),
    byOutcome: countBy(outcomes),
  };
  await deps.writeText(
    paths.manifest,
    `${JSON.stringify(
      {
        generator_version: GENERATOR_VERSION,
        cohort_id: args.cohortId,
        seed: args.seed,
        anchor_day: args.anchorDay,
        system_prompt_id: prompt.id,
        files: { records: paths.records, meta: paths.meta },
        ...summary,
        // One copy of the tool definitions; --inline-tools also puts them on every line.
        tools: toolSchemas(),
      },
      null,
      2,
    )}\n`,
  );
  io.stdout.write(
    [
      `Conversations written to ${paths.records} (meta in ${paths.meta})`,
      `Cohort ${args.cohortId}, seed ${args.seed}: ${summary.subjects} subjects, ${summary.conversations} conversations`,
      `By family: ${JSON.stringify(summary.byFamily)}`,
      `By outcome: ${JSON.stringify(summary.byOutcome)}`,
      "",
    ].join("\n"),
  );
  return 0;
};

/** The real tools, audited as `training-conversations`. Imported lazily: they need the server-only preload. */
export const realPorts = async (today: string): Promise<ConversationPorts> => {
  const tools = await import("../../packages/query-tools/tools");
  const { database } = await import("../../infrastructure/database");
  const { buildTwinSystemPrompt } =
    await import("../../features/chat/twin-system-prompt");
  const scope = {
    actor: TRAINING_ACTOR,
    sessionId: `${TRAINING_ACTOR}-${today}`,
    mode: "synthetic",
  } as const;
  const runTool = (name: ToolName, args: unknown): Promise<unknown> => {
    switch (name) {
      case "subject_window":
        return tools.runSubjectWindow(scope, subjectWindowInput.parse(args));
      case "latest_by_loinc":
        return tools.runLatestByLoinc(scope, KEYED_TOOLS.latest_by_loinc.parse(args));
      case "trend":
        return tools.runTrend(scope, KEYED_TOOLS.trend.parse(args));
      case "baseline_deviation":
        return tools.runBaselineDeviation(
          scope,
          KEYED_TOOLS.baseline_deviation.parse(args),
        );
      case "coverage":
        return tools.runCoverage(scope, KEYED_TOOLS.coverage.parse(args));
      case "compare_windows":
        return tools.runCompareWindows(scope, KEYED_TOOLS.compare_windows.parse(args));
    }
  };
  return {
    // Subject refs only; every number still comes through the audited tools.
    listSubjects: async (cohortId) =>
      (
        await database().subject.findMany({
          where: { cohortId, isSynthetic: true },
          select: { subjectRef: true },
          orderBy: { subjectRef: "asc" },
        })
      ).map((row) => row.subjectRef),
    runTool,
    systemPrompt: async () => ({
      id: "twin-system-prompt/synthetic/no-wearables",
      text: buildTwinSystemPrompt({
        mode: "synthetic",
        oura: null,
        whoop: null,
        googleHealth: null,
        vitronic: null,
      }),
    }),
  };
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  const { serverEnv } = await import("../../infrastructure/env");
  const { isoLocalDate } = await import("../../infrastructure/format-measure");
  const { database } = await import("../../infrastructure/database");
  const code = await runBuildConversations(process.argv.slice(2), process, {
    dataMode: () => serverEnv().DATA_MODE,
    ports: () => realPorts(isoLocalDate()),
    openOut: async (path) => {
      await mkdir(dirname(path), { recursive: true });
      const stream = createWriteStream(path);
      return {
        write: (line) =>
          new Promise<void>((done, fail) =>
            stream.write(line, (error) => (error ? fail(error) : done())),
          ),
        close: () => new Promise<void>((done) => stream.end(done)),
      };
    },
    writeText: (path, text) => writeFile(path, text),
    rename: (from, to) => rename(from, to),
    remove: (path) => rm(path, { force: true }),
  });
  await database().$disconnect();
  process.exit(code);
}
