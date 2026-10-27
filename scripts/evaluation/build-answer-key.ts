/**
 * Host CLI: compute the C2 answer key from the fixed-seed synthetic cohort.
 *
 * Usage (from repo root). `.env.eval` (gitignored) is a copy of
 * `.env.synthetic.example` with DATABASE_URL at a throwaway database holding
 * only synthea-v4-seed42. The script passes `--env-file=.env.eval`, so Bun
 * never loads `.env.local`:
 *   bun run eval:answer-key
 *   bun run eval:answer-key --questions evaluation/questions.v1.json --out evaluation/answer-key.v1.json
 *
 * Every number in the key comes from the same closed, audited query tools the
 * model calls (actor `eval-answer-key`), never from a hand-written value or a
 * second implementation of the maths, so the key and the tools cannot drift
 * apart silently. The tools are injected, so the build is unit-tested with
 * fakes. Prints counts only, never observation values.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

import { isToolRefusal } from "../../packages/query-tools/refusals";
import { cohortContentSha256 } from "../synthea/cohort-checksum";
import { COHORT_PRESETS } from "../synthea/cohort-presets";
import {
  type AnswerKey,
  answerKeySchema,
  COHORT_ID,
  type KeyEntry,
  type KeyedTool,
  KEYED_TOOLS,
  type QuestionSet,
  questionSetSchema,
  readPath,
  type ValueSpec,
} from "./question-set";

export const GENERATOR_VERSION = "2";
export const ANSWER_KEY_ACTOR = "eval-answer-key";
export const DEFAULT_QUESTIONS = "evaluation/questions.v1.json";
export const DEFAULT_OUT = "evaluation/answer-key.v1.json";

/** Where `--preset eval` writes the patient files the key is built from. */
export const EVAL_FHIR_DIR = `${COHORT_PRESETS.eval.out}/fhir`;

/**
 * How the cohort was generated (`--preset eval`, docs/warehouse.md). The
 * subject count and the checksum of the patient files are read at build time.
 */
export const COHORT_GENERATION = {
  synthea_version: "v4.0.0",
  seed: COHORT_PRESETS.eval.seed,
  population: COHORT_PRESETS.eval.population,
  age: COHORT_PRESETS.eval.age,
  reference_date: COHORT_PRESETS.eval.referenceDate,
  end_date: COHORT_PRESETS.eval.endDate,
} as const;

export type AnswerKeyPorts = Readonly<{
  /** One audited query tool call; returns the tool's result or refusal. */
  runTool: (tool: KeyedTool, args: unknown) => Promise<unknown>;
  /** Subjects in the cohort, through the audited `list_subjects`. */
  countSubjects: () => Promise<number>;
  /** The checksum of the cohort's patient files (`contentSha256` in its manifest). */
  cohortSha256: () => Promise<string>;
  openTwinSha: () => string;
  /** Today as YYYY-MM-DD. */
  today: () => string;
}>;

type Window = Readonly<{ start: string; end: string }>;

const isWindow = (value: unknown): value is Window =>
  typeof value === "object" &&
  value !== null &&
  typeof Reflect.get(value, "start") === "string" &&
  typeof Reflect.get(value, "end") === "string";

const asWindow = (value: Window): Window => ({ start: value.start, end: value.end });

/** The windows a call read, in argument order. */
export const windowsOf = (args: Readonly<Record<string, unknown>>): Window[] => {
  if (isWindow(args)) return [asWindow(args)];
  return ["baseline", "target", "window_a", "window_b"]
    .map((name) => args[name])
    .filter(isWindow)
    .map(asWindow);
};

const numberAt = (result: unknown, path: string): number => {
  const value = readPath(result, path);
  return typeof value === "number" ? value : 0;
};

const lengthAt = (result: unknown, path: string): number => {
  const value = readPath(result, path);
  return Array.isArray(value) ? value.length : 0;
};

/** Observations read, counted the way each tool's audit row counts them. */
export const rowCountOf = (tool: KeyedTool, result: unknown): number => {
  if (isToolRefusal(result)) return 0;
  switch (tool) {
    case "trend":
    case "summary_stats":
      return numberAt(result, "n");
    case "baseline_deviation":
      return numberAt(result, "baseline.n") + numberAt(result, "target.n");
    case "compare_windows":
      return numberAt(result, "window_a.n") + numberAt(result, "window_b.n");
    case "range_position":
      return numberAt(result, "n");
    case "convert_unit":
      // A conversion reads no rows (audit row_count 0).
      return 0;
    case "cohort_position":
      return numberAt(result, "rows_read");
    case "conditions_timeline":
      return numberAt(result, "n");
    case "medications_timeline":
      return numberAt(result, "n");
    case "sleep_summary":
    case "hrv_trend":
    case "resting_hr_trend":
    case "training_load":
      // Wearable readings in the window, as the audit row counts them.
      return numberAt(result, "n");
    case "cross_source_compare":
      return numberAt(result, "n");
    case "latest_by_loinc":
      return lengthAt(result, "rows");
    case "coverage": {
      const codes = readPath(result, "codes");
      return Array.isArray(codes)
        ? codes.reduce<number>((total, code) => total + numberAt(code, "n"), 0)
        : 0;
    }
  }
};

/** Fields whose name carries their unit (the wearable tools'): `mean_duration_min`, `minutes`, `mean_efficiency_pct`. */
const unitInName = (field: string): string | null =>
  field === "minutes" || field.endsWith("_min")
    ? "min"
    : field.endsWith("_pct")
      ? "%"
      : null;

/**
 * The unit for the value at `path`: one its field name carries (`_min`, `_pct`),
 * a slope's own `slope_unit` (`%/d`), else the nearest `unit` or `unit_ucum`
 * (`codes.0.n` → `codes.0.unit`, `rows.0.value` → `rows.0.unit_ucum`).
 */
export const unitNear = (result: unknown, path: string): string | null => {
  const segments = path.split(".");
  const named = unitInName(segments.at(-1) ?? "");
  if (named !== null) return named;
  const parents = segments.map((_, index) => segments.slice(0, index).join("."));
  const last = segments.at(-1);
  const names =
    last === "slope_per_day"
      ? ["slope_unit"]
      : last === "slope_per_week"
        ? ["slope_per_week_unit"]
        : ["unit", "unit_ucum"];
  const found = parents
    .reverse()
    .flatMap((parent) =>
      names.map((name) => readPath(result, parent === "" ? name : `${parent}.${name}`)),
    )
    .find((value): value is string => typeof value === "string");
  return found ?? null;
};

export class AnswerKeyError extends Error {}

/** Lists that may come back empty: no row for a code is no value, never zero. */
const EMPTY_OK = new Set(["rows", "codes"]);

/**
 * The number at `path`, or null when the tool returned null there or an empty
 * `rows`/`codes` list. A path that does not exist in the result throws, so a
 * misspelt path can never pass as an expected null.
 */
export const valueAt = (result: unknown, path: string): number | null => {
  const segments = path.split(".");
  let current: unknown = result;
  for (const [index, segment] of segments.entries()) {
    if (typeof current !== "object" || current === null) {
      throw new AnswerKeyError(`no ${path} in the result`);
    }
    if (
      Array.isArray(current) &&
      current.length === 0 &&
      EMPTY_OK.has(segments[index - 1] ?? "")
    ) {
      return null;
    }
    if (!Reflect.has(current, segment)) {
      throw new AnswerKeyError(`no ${path} in the result`);
    }
    current = Reflect.get(current, segment);
  }
  if (current === null || typeof current === "number") return current;
  throw new AnswerKeyError(`no number at ${path}`);
};

type RunOnce = (tool: KeyedTool, args: unknown) => Promise<unknown>;

/** Values read from the same call share one audited read instead of repeating it. */
const runOnce = (ports: AnswerKeyPorts): RunOnce => {
  const seen = new Map<string, Promise<unknown>>();
  return (tool, args) => {
    const id = `${tool} ${JSON.stringify(args)}`;
    const pending = seen.get(id) ?? ports.runTool(tool, args);
    seen.set(id, pending);
    return pending;
  };
};

const keyEntry = async (
  itemId: string,
  spec: ValueSpec,
  run: RunOnce,
): Promise<KeyEntry> => {
  const args = KEYED_TOOLS[spec.tool].parse(spec.args);
  const result = await run(spec.tool, args).catch(() => {
    throw new AnswerKeyError(`${itemId} ${spec.name}: ${spec.tool} failed`);
  });
  const base = {
    name: spec.name,
    tool: spec.tool,
    args: spec.args,
    path: spec.path,
    n: rowCountOf(spec.tool, result),
    windows: windowsOf(spec.args),
  };
  if (isToolRefusal(result)) {
    return {
      ...base,
      value: spec.path === "code" ? result.code : null,
      unit: null,
      refusal: result.code,
    };
  }
  if (spec.path === "code") {
    throw new AnswerKeyError(`${itemId} ${spec.name}: ${spec.tool} did not refuse`);
  }
  let value: number | null;
  try {
    value = valueAt(result, spec.path);
  } catch (error) {
    if (!(error instanceof AnswerKeyError)) throw error;
    throw new AnswerKeyError(`${itemId} ${spec.name}: ${error.message}`);
  }
  const unit = spec.unit === null ? null : unitNear(result, spec.path);
  if (value !== null && spec.unit !== null && unit !== spec.unit) {
    throw new AnswerKeyError(`${itemId} ${spec.name}: unit is not ${spec.unit}`);
  }
  return { ...base, value, unit, refusal: null };
};

/** sha256 of the questions as parsed JSON, so re-formatting the file does not change it. */
export const questionsSha256 = (raw: unknown): string =>
  createHash("sha256").update(JSON.stringify(raw)).digest("hex");

export const buildAnswerKey = async (
  raw: unknown,
  ports: AnswerKeyPorts,
): Promise<AnswerKey> => {
  const set: QuestionSet = questionSetSchema.parse(raw);
  const run = runOnce(ports);
  const entries: Record<string, KeyEntry[]> = {};
  // One call at a time, in file order, so the audit chain reads like the file.
  for (const item of set.items) {
    const specs = item.expect.values ?? [];
    if (specs.length === 0) continue;
    const keyed: KeyEntry[] = [];
    for (const spec of specs) keyed.push(await keyEntry(item.id, spec, run));
    entries[item.id] = keyed;
  }
  return answerKeySchema.parse({
    schema_version: "twin-llm.eval.answer-key.v1",
    generator_version: GENERATOR_VERSION,
    cohort: {
      id: COHORT_ID,
      ...COHORT_GENERATION,
      subjects: await ports.countSubjects(),
      content_sha256: await ports.cohortSha256(),
    },
    open_twin_sha: ports.openTwinSha(),
    questions_sha256: questionsSha256(raw),
    actor: ANSWER_KEY_ACTOR,
    generated_on: ports.today(),
    entries,
  });
};

export type AnswerKeySummary = Readonly<{
  itemsKeyed: number;
  values: number;
  refusals: number;
  nullValues: number;
}>;

export const summarise = (key: AnswerKey): AnswerKeySummary => {
  const all = Object.values(key.entries).flat();
  return {
    itemsKeyed: Object.keys(key.entries).length,
    values: all.length,
    refusals: all.filter((entry) => entry.refusal !== null).length,
    nullValues: all.filter((entry) => entry.value === null).length,
  };
};

export type BuildIo = Readonly<{
  stdout: { write: (chunk: string) => void };
  stderr: { write: (chunk: string) => void };
}>;

export type BuildDeps = Readonly<{
  dataMode: () => string;
  readText: (path: string) => Promise<string>;
  writeKey: (path: string, key: AnswerKey) => Promise<void>;
  ports: () => AnswerKeyPorts;
}>;

const argValue = (argv: readonly string[], flag: string, fallback: string): string => {
  const index = argv.indexOf(flag);
  return index === -1 ? fallback : (argv[index + 1] ?? fallback);
};

export const runBuildAnswerKey = async (
  argv: readonly string[],
  io: BuildIo,
  deps: BuildDeps,
): Promise<number> => {
  if (deps.dataMode() !== "synthetic") {
    io.stderr.write("eval:answer-key runs only with DATA_MODE=synthetic.\n");
    return 1;
  }
  const questionsPath = argValue(argv, "--questions", DEFAULT_QUESTIONS);
  const outPath = argValue(argv, "--out", DEFAULT_OUT);
  let raw: unknown;
  try {
    raw = JSON.parse(await deps.readText(questionsPath)) as unknown;
  } catch {
    io.stderr.write(`Cannot read questions from ${questionsPath}.\n`);
    return 1;
  }
  let key: AnswerKey;
  try {
    key = await buildAnswerKey(raw, deps.ports());
  } catch (error) {
    io.stderr.write(
      error instanceof AnswerKeyError
        ? `Answer key not written: ${error.message}.\n`
        : "Answer key not written: the questions or a tool result did not validate.\n",
    );
    return 1;
  }
  await deps.writeKey(outPath, key);
  const summary = summarise(key);
  io.stdout.write(
    [
      `Answer key written to ${outPath}`,
      `Cohort ${key.cohort.id}: ${key.cohort.subjects} subjects (Synthea ${key.cohort.synthea_version}, seed ${key.cohort.seed}, dates ${key.cohort.reference_date}–${key.cohort.end_date})`,
      `Patient files checksum ${key.cohort.content_sha256}`,
      `Items keyed: ${summary.itemsKeyed}, values: ${summary.values}, refusals: ${summary.refusals}, null values: ${summary.nullValues}`,
      `open-twin ${key.open_twin_sha}, generated ${key.generated_on}`,
      "",
    ].join("\n"),
  );
  return 0;
};

/** A refused cohort is not an empty one: never key a count of 0 from it. */
export const subjectCount = (
  result: Readonly<{ subjects: readonly unknown[] }> | Readonly<{ code: string }>,
): number => {
  if (!("subjects" in result)) {
    throw new AnswerKeyError(`list_subjects refused ${COHORT_ID}`);
  }
  return result.subjects.length;
};

/** The real tools, audited as `eval-answer-key`. Imported lazily: they need the server-only preload. */
export const realPorts = async (today: string): Promise<AnswerKeyPorts> => {
  const tools = await import("../../packages/query-tools/tools");
  const scope = {
    actor: ANSWER_KEY_ACTOR,
    sessionId: `${ANSWER_KEY_ACTOR}-${today}`,
    mode: "synthetic",
  } as const;
  const run = (tool: KeyedTool, args: unknown): Promise<unknown> => {
    switch (tool) {
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
      case "range_position":
        return tools.runRangePosition(scope, KEYED_TOOLS.range_position.parse(args));
      case "convert_unit":
        return tools.runConvertUnit(scope, KEYED_TOOLS.convert_unit.parse(args));
      case "cohort_position":
        return tools.runCohortPosition(scope, KEYED_TOOLS.cohort_position.parse(args));
      case "conditions_timeline":
        return tools.runConditionsTimeline(
          scope,
          KEYED_TOOLS.conditions_timeline.parse(args),
        );
      case "medications_timeline":
        return tools.runMedicationsTimeline(
          scope,
          KEYED_TOOLS.medications_timeline.parse(args),
        );
      case "sleep_summary":
        return tools.runSleepSummary(scope, KEYED_TOOLS.sleep_summary.parse(args));
      case "hrv_trend":
        return tools.runHrvTrend(scope, KEYED_TOOLS.hrv_trend.parse(args));
      case "resting_hr_trend":
        return tools.runRestingHrTrend(scope, KEYED_TOOLS.resting_hr_trend.parse(args));
      case "training_load":
        return tools.runTrainingLoad(scope, KEYED_TOOLS.training_load.parse(args));
      case "cross_source_compare":
        return tools.runCrossSourceCompare(
          scope,
          KEYED_TOOLS.cross_source_compare.parse(args),
        );
      case "latest_by_loinc":
        return tools.runLatestByLoinc(scope, KEYED_TOOLS.latest_by_loinc.parse(args));
      case "summary_stats":
        return tools.runSummaryStats(scope, KEYED_TOOLS.summary_stats.parse(args));
    }
  };
  return {
    runTool: run,
    countSubjects: async () => {
      const result = await tools.runListSubjects(scope, { cohort_id: COHORT_ID });
      return subjectCount(result);
    },
    cohortSha256: () => cohortContentSha256(EVAL_FHIR_DIR),
    openTwinSha: () =>
      execFileSync("git", ["-C", ".open-twin", "rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
    today: () => today,
  };
};

/** Prettier-formatted, so a fresh run diffs cleanly against the committed file. */
export const formatKey = async (key: AnswerKey, path: string): Promise<string> => {
  const prettier = await import("prettier");
  const options = await prettier.resolveConfig(path);
  return prettier.format(JSON.stringify(key), { ...options, parser: "json" });
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  const { serverEnv } = await import("../../infrastructure/env");
  const { isoLocalDate } = await import("../../infrastructure/format-measure");
  const today = isoLocalDate();
  const ports = await realPorts(today);
  const code = await runBuildAnswerKey(process.argv.slice(2), process, {
    dataMode: () => serverEnv().DATA_MODE,
    readText: (path) => readFile(path, "utf8"),
    writeKey: async (path, key) => writeFile(path, await formatKey(key, path)),
    ports: () => ports,
  });
  process.exit(code);
}
