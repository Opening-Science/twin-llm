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
 * The S7 set (#251) is keyed without a database: `--cohort-dir` names a folder
 * holding the pinned cohort's `fhir/` (unpacked from the eval-cohort-v1 release)
 * and the same tools run over it in memory (`cohort-ports.ts`):
 *   bun run eval:answer-key:s7 -- --cohort-dir <folder>
 * The S7b set (#277) reads the supplementary cohort `synthea-v4-s7` the same
 * way (`bun run synthea:s7 -- load`, then `.synthea/synthea-v4-s7`):
 *   bun run eval:answer-key:s7b -- --cohort-dir .synthea/synthea-v4-s7
 * The hb set (#293) reads the AF subset of the 1M batches, `synthea-v4-1m-af`,
 * from the throwaway eval database (it is far too large to key in memory):
 *   bun run eval:answer-key:hb
 * The questions' `cohort_id` says which cohort a set is keyed against.
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

import { AF_SUBSET_COHORT } from "../../packages/query-tools/event-rates/cohort-rates";
import type { QueryToolPorts } from "../../packages/query-tools/ports";
import { isToolRefusal } from "../../packages/query-tools/refusals";
import type { SessionScope } from "../../packages/query-tools/scope";
import type * as QueryToolsModule from "../../packages/query-tools/tools";
import { cohortContentSha256 } from "../synthea/cohort-checksum";
import { COHORT_PRESETS, S7_COHORT_ID } from "../synthea/cohort-presets";
import { S7_ARMS, S7_COHORT_DIR, S7_RECIPE } from "../synthea/s7-cohort";
import {
  type AnswerKey,
  answerKeySchema,
  COHORT_ID,
  type EvalCohortId,
  type KeyEntry,
  type KeyedTool,
  KEYED_TOOLS,
  type QuestionSet,
  questionSetSchema,
  readPath,
  type ValueSpec,
} from "./question-set";
import { isVerdict } from "./score/verdict-match";

export const GENERATOR_VERSION = "2";
export const ANSWER_KEY_ACTOR = "eval-answer-key";
export const DEFAULT_QUESTIONS = "evaluation/questions.v1.json";
export const DEFAULT_OUT = "evaluation/answer-key.v1.json";
export const S7_QUESTIONS = "evaluation/questions.s7.v1.json";
export const S7_OUT = "evaluation/answer-key.s7.v1.json";

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

/** How the supplementary S7 cohort was generated (#277): three keep-module runs. */
export const S7_COHORT_GENERATION = {
  synthea_version: S7_RECIPE.syntheaVersion,
  seed: S7_ARMS[0]?.seed ?? 0,
  population: S7_ARMS.reduce((sum, arm) => sum + arm.population, 0),
  age: S7_RECIPE.age,
  reference_date: S7_RECIPE.referenceDate,
  end_date: S7_RECIPE.endDate,
} as const;

/** Where the AF subset's record is committed: recipe, batches, ids and checksum. */
export const HB_MANIFEST_PATH = "evaluation/cohorts/synthea-v4-1m-af.manifest.json";

/** The AF subset's files, as `bun run heart-brain:af-subset` writes them. */
export const HB_COHORT_DIR = `.synthea/${AF_SUBSET_COHORT}`;

/**
 * How the 1M batches were generated (seeds 1001 to 1100, clinician seed + 1000,
 * 10,000 living people each, all ages); the AF subset keeps their people with AF.
 */
export const HB_COHORT_GENERATION = {
  synthea_version: "v4.0.0",
  seed: 1001,
  population: 1_000_000,
  age: "any",
  reference_date: "20260101",
  end_date: "20260101",
  runs: Array.from({ length: 100 }, (_, index) => ({
    name: `batch-${String(index + 1).padStart(3, "0")}`,
    seed: 1001 + index,
    clinician_seed: 2001 + index,
    population: 10_000,
  })),
} as const;

/** The generation fields of a key's `cohort`, for the cohort its questions name. */
export const cohortGeneration = (cohortId: EvalCohortId) =>
  cohortId === AF_SUBSET_COHORT
    ? HB_COHORT_GENERATION
    : cohortId === S7_COHORT_ID
      ? {
          ...S7_COHORT_GENERATION,
          runs: S7_ARMS.map((arm) => ({
            name: arm.name,
            seed: arm.seed,
            clinician_seed: arm.clinicianSeed,
            population: arm.population,
          })),
        }
      : COHORT_GENERATION;

/** Where the patient files of a cohort are on disk after generating or loading it. */
export const fhirDirOf = (cohortId: EvalCohortId): string =>
  cohortId === AF_SUBSET_COHORT
    ? `${HB_COHORT_DIR}/fhir`
    : cohortId === S7_COHORT_ID
      ? `${S7_COHORT_DIR}/fhir`
      : EVAL_FHIR_DIR;

/** `contentSha256` from a committed cohort manifest, so 100 GB need not be hashed per build. */
export const manifestContentSha256 = (text: string): string => {
  const parsed: unknown = JSON.parse(text);
  const sha =
    typeof parsed === "object" && parsed !== null
      ? Reflect.get(parsed, "contentSha256")
      : undefined;
  if (typeof sha !== "string" || !/^[0-9a-f]{64}$/.test(sha)) {
    throw new AnswerKeyError("the cohort manifest has no contentSha256");
  }
  return sha;
};

/** Subjects a `cohort_event_rates` call read: `list_subjects` stops at 200. */
export const subjectsRead = (result: unknown, cohortId: EvalCohortId): number => {
  const read =
    typeof result === "object" && result !== null
      ? Reflect.get(result, "subjects_read")
      : undefined;
  if (typeof read !== "number") {
    throw new AnswerKeyError(`cohort_event_rates refused ${cohortId}`);
  }
  return read;
};

/** The data mode a keyed call runs in (`ValueSpec.mode`, synthetic when left out). */
export type KeyMode = "synthetic" | "personal";

export type AnswerKeyPorts = Readonly<{
  /** One audited query tool call; returns the tool's result or refusal. */
  runTool: (tool: KeyedTool, args: unknown, mode: KeyMode) => Promise<unknown>;
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
      return numberAt(result, "n_pairs");
    case "values_around_event":
      return numberAt(result, "before.n") + numberAt(result, "after.n");
    case "rhythm_irregularity":
      return numberAt(result, "n");
    case "cohort_event_rates":
      return numberAt(result, "rows_read");
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

type RunOnce = (tool: KeyedTool, args: unknown, mode: KeyMode) => Promise<unknown>;

/** Values read from the same call share one audited read instead of repeating it. */
const runOnce = (ports: AnswerKeyPorts): RunOnce => {
  const seen = new Map<string, Promise<unknown>>();
  return (tool, args, mode) => {
    const id = `${mode} ${tool} ${JSON.stringify(args)}`;
    const pending = seen.get(id) ?? ports.runTool(tool, args, mode);
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
  const result = await run(spec.tool, args, spec.mode ?? "synthetic").catch(() => {
    throw new AnswerKeyError(`${itemId} ${spec.name}: ${spec.tool} failed`);
  });
  const base = {
    name: spec.name,
    tool: spec.tool,
    args: spec.args,
    path: spec.path,
    n: rowCountOf(spec.tool, result),
    windows: windowsOf(spec.args),
    ...(spec.mode === undefined ? {} : { mode: spec.mode }),
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
  if (spec.path === "verdict") {
    const verdict = Reflect.get(result as object, "verdict");
    if (!isVerdict(verdict)) {
      throw new AnswerKeyError(`${itemId} ${spec.name}: no verdict in the result`);
    }
    return { ...base, value: verdict, unit: null, refusal: null };
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
  const { runs, ...generation } = {
    runs: undefined,
    ...cohortGeneration(set.cohort_id),
  };
  return answerKeySchema.parse({
    schema_version: "twin-llm.eval.answer-key.v1",
    generator_version: GENERATOR_VERSION,
    cohort: {
      id: set.cohort_id,
      ...generation,
      subjects: await ports.countSubjects(),
      content_sha256: await ports.cohortSha256(),
      ...(runs === undefined ? {} : { runs }),
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
  /** The ports for the cohort the questions name. */
  ports: (cohortId: EvalCohortId) => Promise<AnswerKeyPorts>;
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
  const parsed = questionSetSchema.safeParse(raw);
  if (!parsed.success) {
    io.stderr.write(
      "Answer key not written: the questions or a tool result did not validate.\n",
    );
    return 1;
  }
  let key: AnswerKey;
  try {
    key = await buildAnswerKey(raw, await deps.ports(parsed.data.cohort_id));
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
  cohortId: EvalCohortId = COHORT_ID,
): number => {
  if (!("subjects" in result)) {
    throw new AnswerKeyError(`list_subjects refused ${cohortId}`);
  }
  return result.subjects.length;
};

type QueryTools = typeof QueryToolsModule;

/** One keyed call through the real tool function; `ports` absent means the database. */
export const runKeyedTool = (
  tools: QueryTools,
  scope: SessionScope,
  tool: KeyedTool,
  args: unknown,
  ports?: QueryToolPorts,
): Promise<unknown> => {
  switch (tool) {
    case "trend":
      return tools.runTrend(scope, KEYED_TOOLS.trend.parse(args), ports);
    case "baseline_deviation":
      return tools.runBaselineDeviation(
        scope,
        KEYED_TOOLS.baseline_deviation.parse(args),
        ports,
      );
    case "coverage":
      return tools.runCoverage(scope, KEYED_TOOLS.coverage.parse(args), ports);
    case "compare_windows":
      return tools.runCompareWindows(
        scope,
        KEYED_TOOLS.compare_windows.parse(args),
        ports,
      );
    case "range_position":
      return tools.runRangePosition(scope, KEYED_TOOLS.range_position.parse(args), ports);
    case "convert_unit":
      return tools.runConvertUnit(scope, KEYED_TOOLS.convert_unit.parse(args), ports);
    case "cohort_position":
      return tools.runCohortPosition(
        scope,
        KEYED_TOOLS.cohort_position.parse(args),
        ports,
      );
    case "conditions_timeline":
      return tools.runConditionsTimeline(
        scope,
        KEYED_TOOLS.conditions_timeline.parse(args),
        ports,
      );
    case "medications_timeline":
      return tools.runMedicationsTimeline(
        scope,
        KEYED_TOOLS.medications_timeline.parse(args),
        ports,
      );
    case "sleep_summary":
      return tools.runSleepSummary(scope, KEYED_TOOLS.sleep_summary.parse(args), ports);
    case "hrv_trend":
      return tools.runHrvTrend(scope, KEYED_TOOLS.hrv_trend.parse(args), ports);
    case "resting_hr_trend":
      return tools.runRestingHrTrend(
        scope,
        KEYED_TOOLS.resting_hr_trend.parse(args),
        ports,
      );
    case "training_load":
      return tools.runTrainingLoad(scope, KEYED_TOOLS.training_load.parse(args), ports);
    case "cross_source_compare":
      return tools.runCrossSourceCompare(
        scope,
        KEYED_TOOLS.cross_source_compare.parse(args),
        ports,
      );
    case "values_around_event":
      return tools.runValuesAroundEvent(
        scope,
        KEYED_TOOLS.values_around_event.parse(args),
        ports,
      );
    case "rhythm_irregularity":
      return tools.runRhythmIrregularity(
        scope,
        KEYED_TOOLS.rhythm_irregularity.parse(args),
        ports,
      );
    case "cohort_event_rates":
      return tools.runCohortEventRates(
        scope,
        KEYED_TOOLS.cohort_event_rates.parse(args),
        ports,
      );
    // These two read the database directly (no ports), so they cannot be keyed from files.
    case "latest_by_loinc":
      return ports === undefined
        ? tools.runLatestByLoinc(scope, KEYED_TOOLS.latest_by_loinc.parse(args))
        : Promise.reject(new AnswerKeyError(`${tool} reads the database only`));
    case "summary_stats":
      return ports === undefined
        ? tools.runSummaryStats(scope, KEYED_TOOLS.summary_stats.parse(args))
        : Promise.reject(new AnswerKeyError(`${tool} reads the database only`));
  }
};

const scopeFor = (today: string, mode: KeyMode): SessionScope => ({
  actor: ANSWER_KEY_ACTOR,
  sessionId: `${ANSWER_KEY_ACTOR}-${today}`,
  mode,
});

const openTwinHead = (): string =>
  execFileSync("git", ["-C", ".open-twin", "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();

/** The real tools, audited as `eval-answer-key`. Imported lazily: they need the server-only preload. */
export const realPorts = async (
  today: string,
  cohortId: EvalCohortId,
): Promise<AnswerKeyPorts> => {
  const tools = await import("../../packages/query-tools/tools");
  return {
    runTool: (tool, args, mode) => runKeyedTool(tools, scopeFor(today, mode), tool, args),
    countSubjects: async () => {
      if (cohortId === AF_SUBSET_COHORT) {
        const rates = await tools.runCohortEventRates(scopeFor(today, "synthetic"), {
          cohort_id: cohortId,
          exposure_code: "49436004",
          outcome_code: "230690007",
          design: "within",
        });
        return subjectsRead(rates, cohortId);
      }
      const result = await tools.runListSubjects(scopeFor(today, "synthetic"), {
        cohort_id: cohortId,
      });
      return subjectCount(result, cohortId);
    },
    cohortSha256: async () =>
      cohortId === AF_SUBSET_COHORT
        ? manifestContentSha256(await readFile(HB_MANIFEST_PATH, "utf8"))
        : cohortContentSha256(fhirDirOf(cohortId)),
    openTwinSha: openTwinHead,
    today: () => today,
  };
};

/**
 * The same tools over the pinned cohort's patient files in memory
 * (`cohort-ports.ts`): no database, no env. `dir` holds `fhir/`. The audit
 * rows stay in memory and are dropped with the run.
 */
export const cohortFilePorts = async (
  dir: string,
  today: string,
  cohortId: EvalCohortId = COHORT_ID,
): Promise<AnswerKeyPorts> => {
  const tools = await import("../../packages/query-tools/tools");
  const { cohortSubjectFrom, loadCohortBundles, memoryPorts } =
    await import("./cohort-ports");
  const fhir = `${dir}/fhir`;
  const subjects = (await loadCohortBundles(fhir)).flatMap((bundle) => {
    const subject = cohortSubjectFrom(
      bundle,
      cohortId,
      cohortGeneration(cohortId).synthea_version,
    );
    return subject === null ? [] : [subject];
  });
  const ports = memoryPorts(subjects);
  return {
    runTool: (tool, args, mode) =>
      runKeyedTool(tools, scopeFor(today, mode), tool, args, ports),
    // `list_subjects` reads the database only; here the subjects are the bundles ingest would keep.
    countSubjects: () => Promise.resolve(subjects.length),
    cohortSha256: () => cohortContentSha256(fhir),
    openTwinSha: openTwinHead,
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
  const { isoLocalDate } = await import("../../infrastructure/format-measure");
  const today = isoLocalDate();
  const argv = process.argv.slice(2);
  const cohortDir = argValue(argv, "--cohort-dir", "");
  // Over cohort files nothing but the synthetic cohort can be read, so no env is loaded.
  const offline = cohortDir !== "";
  const dataMode = offline
    ? "synthetic"
    : (await import("../../infrastructure/env")).serverEnv().DATA_MODE;
  const code = await runBuildAnswerKey(argv, process, {
    dataMode: () => dataMode,
    readText: (path) => readFile(path, "utf8"),
    writeKey: async (path, key) => writeFile(path, await formatKey(key, path)),
    ports: (cohortId) =>
      offline ? cohortFilePorts(cohortDir, today, cohortId) : realPorts(today, cohortId),
  });
  process.exit(code);
}
