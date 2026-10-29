/**
 * `bun run eval`: runs the C2 questions through the chat pipeline and writes
 * one results line per item × repeat × model (C3a). Scoring is C3b.
 *
 * Each item is one turn of `runTwinTurn`, the code the chat route runs: the same
 * system prompt (synthetic mode), the same tools with real audit rows (actor
 * `eval-harness:<run-id>`), the same step limit and response document. Only the
 * model is wrapped, by the record/replay cache in `model-cache.ts`.
 *
 * Everything with a side effect is a port, so the tests drive the whole run
 * with a fake model and fake tool ports, and no database or GPU.
 */
import { type LanguageModel, type ToolSet } from "ai";

import { publicProviderFailure } from "../../features/chat/public-provider-failure";
import {
  runTwinTurn,
  type TwinTurnFinish,
  type TwinTurnToolResult,
} from "../../features/chat/run-twin-turn";
import { sha256Hex, toCanonicalJson } from "../../packages/audit/hash";
import { isToolRefusal } from "../../packages/query-tools/refusals";
import type { SessionScope } from "../../packages/query-tools/scope";
import type {
  ResponseDocumentV1,
  ResponseToolCall,
} from "../../infrastructure/response-document/document-v1";

import { questionsSha256 } from "./build-answer-key";
import {
  type AuditLine,
  isQuestionSetId,
  META_SCHEMA_VERSION,
  MISSING_ENV,
  QUESTION_SET_IDS,
  QUESTION_SETS,
  type QuestionSetId,
  type ResultError,
  type ResultLine,
  RESULTS_SCHEMA_VERSION,
  type RunMeta,
} from "./eval-results";
import { type CacheStore, createCachedModel, findCacheError } from "./model-cache";
import {
  answerKeySchema,
  LATENCY_SET_TAG,
  type Question,
  questionSetSchema,
  SCENARIOS,
} from "./question-set";

export const EVAL_ACTOR_PREFIX = "eval-harness";
export const DEFAULT_TIMEOUT_S = 300;

export const MOCK_BANNER =
  "MOCK RUN: no real model answered. These lines test the harness and are not a result.";

export type WrappableModel = Exclude<LanguageModel, string>;

export type ResolvedModel = Readonly<{
  model: WrappableModel;
  /** A fake model (tests). Everything it answers is labelled MOCK. */
  mock: boolean;
  /** host:port of the endpoint, never this machine's hostname. */
  host: string | null;
}>;

export type ModelSpec = Readonly<{ provider: string; modelId: string }>;

/** A run that cannot start; `code` is what the user sees first. */
export class EvalSetupError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "EvalSetupError";
  }
}

export type EvalIo = Readonly<{
  stdout: { write: (chunk: string) => void };
  stderr: { write: (chunk: string) => void };
}>;

export type EvalDeps = Readonly<{
  dataMode: string;
  llmProvider: string;
  hasEnv: (name: string) => boolean;
  readText: (path: string) => Promise<string>;
  /** Model ids the provider lists right now (`/v1/models` on the remote GPU). */
  listModels: () => Promise<readonly string[]>;
  /** Called once per listed model before any item runs. */
  resolveModel: (spec: ModelSpec) => Promise<ResolvedModel>;
  /** The per-item time limit; `AbortSignal.timeout` outside tests. */
  timeoutSignal: (timeoutMs: number) => AbortSignal;
  createTools: (scope: SessionScope) => ToolSet;
  loadAudit: (sessionId: string) => Promise<readonly ResponseToolCall[]>;
  cache: CacheStore;
  /** False when the run directory already exists. */
  prepareRun: (runId: string) => Promise<boolean>;
  appendResult: (runId: string, line: string) => Promise<void>;
  writeMeta: (runId: string, json: string) => Promise<void>;
  now: () => number;
  today: () => string;
  newRunId: () => string;
  gitSha: () => string;
  openTwinSha: () => string;
  platform: string;
  /** Server log; gets a fixed message and an allowlisted summary, never provider text. */
  logError: (message: string, detail: unknown) => void;
}>;

export type EvalOptions = Readonly<{
  /** The question set and its key (`--set`, default `v1`). */
  set: QuestionSetId;
  models: readonly ModelSpec[];
  items: readonly string[] | null;
  scenario: string | null;
  latencySet: boolean;
  replay: boolean;
  runId: string | null;
  timeoutMs: number;
}>;

const flagValue = (argv: readonly string[], flag: string): string | null => {
  const index = argv.indexOf(flag);
  if (index === -1) return null;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new EvalSetupError("USAGE", `${flag} needs a value`);
  }
  return value;
};

const list = (value: string): string[] =>
  value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

/** `ollama:qwen3:4b` is provider `ollama`, model `qwen3:4b`: only the first colon splits. */
export const parseModelSpec = (value: string): ModelSpec => {
  const colon = value.indexOf(":");
  if (colon <= 0 || colon === value.length - 1) {
    throw new EvalSetupError("USAGE", `--models takes provider:id, got "${value}"`);
  }
  return { provider: value.slice(0, colon), modelId: value.slice(colon + 1) };
};

const KNOWN_FLAGS = new Set([
  "--set",
  "--models",
  "--items",
  "--scenario",
  "--latency-set",
  "--replay",
  "--run-id",
  "--timeout-s",
]);
const VALUE_FLAGS = new Set([
  "--set",
  "--models",
  "--items",
  "--scenario",
  "--run-id",
  "--timeout-s",
]);

export const parseEvalArgs = (argv: readonly string[]): EvalOptions => {
  // `bun run eval -- --models …` may pass the separator through.
  const args = argv.filter((arg) => arg !== "--");
  args.forEach((arg, index) => {
    const previous = args[index - 1];
    if (previous !== undefined && VALUE_FLAGS.has(previous)) return;
    if (!KNOWN_FLAGS.has(arg))
      throw new EvalSetupError("USAGE", `unknown argument "${arg}"`);
  });
  const models = flagValue(args, "--models");
  if (!models)
    throw new EvalSetupError("USAGE", "--models provider:id[,provider:id] is required");
  const items = flagValue(args, "--items");
  const scenario = flagValue(args, "--scenario");
  const latencySet = args.includes("--latency-set");
  if ([items !== null, scenario !== null, latencySet].filter(Boolean).length > 1) {
    throw new EvalSetupError("USAGE", "use one of --items, --scenario, --latency-set");
  }
  if (scenario !== null && !(SCENARIOS as readonly string[]).includes(scenario)) {
    throw new EvalSetupError("USAGE", `--scenario takes one of ${SCENARIOS.join(", ")}`);
  }
  const set = flagValue(args, "--set") ?? "v1";
  if (!isQuestionSetId(set)) {
    throw new EvalSetupError(
      "USAGE",
      `--set takes one of ${QUESTION_SET_IDS.join(", ")}`,
    );
  }
  const runId = flagValue(args, "--run-id");
  if (runId !== null && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(runId)) {
    throw new EvalSetupError("USAGE", "--run-id takes letters, digits, '.', '_' and '-'");
  }
  const timeout = flagValue(args, "--timeout-s");
  const timeoutS = timeout === null ? DEFAULT_TIMEOUT_S : Number(timeout);
  if (!Number.isInteger(timeoutS) || timeoutS <= 0) {
    throw new EvalSetupError("USAGE", "--timeout-s takes a whole number of seconds");
  }
  return {
    set,
    models: list(models).map(parseModelSpec),
    items: items === null ? null : list(items),
    scenario,
    latencySet,
    replay: args.includes("--replay"),
    runId,
    timeoutMs: timeoutS * 1000,
  };
};

export const selectItems = (
  items: readonly Question[],
  options: Pick<EvalOptions, "items" | "scenario" | "latencySet">,
): Question[] => {
  if (options.items !== null) {
    const unknown = options.items.filter((id) => !items.some((item) => item.id === id));
    if (unknown.length > 0) {
      throw new EvalSetupError("UNKNOWN_ITEM", unknown.join(", "));
    }
    return items.filter((item) => options.items?.includes(item.id));
  }
  if (options.scenario !== null) {
    return items.filter((item) => item.scenario === options.scenario);
  }
  if (options.latencySet) {
    return items.filter((item) => item.tags?.includes(LATENCY_SET_TAG));
  }
  return [...items];
};

/** A placeholder for `--replay`: the cache answers or throws first, so this is never called. */
const replayOnlyModel = (spec: ModelSpec): WrappableModel => ({
  specificationVersion: "v4",
  provider: `eval-replay.${spec.provider}`,
  modelId: spec.modelId,
  supportedUrls: {},
  doGenerate: () => Promise.reject(new Error("replay never calls a model")),
  doStream: () => Promise.reject(new Error("replay never calls a model")),
});

const NO_WEARABLES = { oura: null, whoop: null, googleHealth: null, vitronic: null };

const classifyError = (error: unknown): ResultError => {
  const cacheError = findCacheError(error);
  if (cacheError) return cacheError.code;
  const name = error instanceof Error ? error.name : "";
  if (name === "ProviderNotPermittedError") return "PROVIDER_NOT_PERMITTED";
  if (name === "AbortError" || name === "TimeoutError") return "TIMEOUT";
  return "MODEL_FAILED";
};

type TurnOutcome =
  | Readonly<{
      kind: "finished";
      finish: TwinTurnFinish;
      document: ResponseDocumentV1 | null;
    }>
  | Readonly<{ kind: "failed"; error: ResultError }>;

type TurnRun = Readonly<{
  outcome: TurnOutcome;
  firstTokenAt: number | null;
  finishedAt: number;
}>;

const runTurn = (
  deps: EvalDeps,
  model: LanguageModel,
  scope: SessionScope,
  question: string,
  timeoutMs: number,
  label: string,
): Promise<TurnRun> =>
  new Promise<TurnRun>((resolve) => {
    let firstTokenAt: number | null = null;
    let finishing = false;
    let lastError: unknown = null;
    let settled = false;
    const settle = (outcome: TurnOutcome): void => {
      if (settled) return;
      settled = true;
      resolve({ outcome, firstTokenAt, finishedAt: deps.now() });
    };

    const result = runTwinTurn(
      {
        model,
        tools: deps.createTools(scope),
        mode: "synthetic",
        loadAudit: deps.loadAudit,
      },
      {
        turnId: scope.sessionId,
        messages: [{ role: "user", content: question }],
        wearables: NO_WEARABLES,
        abortSignal: deps.timeoutSignal(timeoutMs),
      },
      {
        onFirstToken: () => {
          firstTokenAt ??= deps.now();
        },
        onFinish: async (finish) => {
          finishing = true;
          const document = await finish.buildDocument().catch((error: unknown) => {
            deps.logError(
              `[eval] ${label} could not build the response document`,
              error instanceof Error ? error.name : "unknown",
            );
            return null;
          });
          settle({ kind: "finished", finish, document });
        },
        onError: async (error) => {
          lastError = error;
          deps.logError(`[eval] ${label} failed`, publicProviderFailure(error));
          settle({ kind: "failed", error: classifyError(error) });
        },
        onAbort: () => {
          settle({ kind: "failed", error: "TIMEOUT" });
        },
      },
    );

    // The stream must be read for the turn to run; its callbacks settle the outcome.
    void Promise.resolve(result.consumeStream({ onError: () => undefined })).then(() => {
      if (!finishing) {
        settle({
          kind: "failed",
          error: lastError === null ? "MODEL_FAILED" : classifyError(lastError),
        });
      }
    });
  });

type CallFacts = Readonly<{ refusal: string | null; subjectRef: string | null }>;

const subjectRefOf = (input: unknown): string | null => {
  const value =
    typeof input === "object" && input !== null
      ? Reflect.get(input, "subject_ref")
      : null;
  return typeof value === "string" ? value : null;
};

/** Keyed like an audit row: tool name and the sha256 of its canonical args. */
const factsByCall = (results: readonly TwinTurnToolResult[]): Map<string, CallFacts> =>
  new Map(
    results.map((result) => [
      `${result.toolName}|${sha256Hex(toCanonicalJson(result.input))}`,
      {
        refusal: isToolRefusal(result.output) ? result.output.code : null,
        subjectRef: subjectRefOf(result.input),
      },
    ]),
  );

/** Audit rows of the turn; refusal code and subject come from the matching tool result. */
export const auditLines = (
  rows: readonly ResponseToolCall[],
  results: readonly TwinTurnToolResult[],
): AuditLine[] => {
  const facts = factsByCall(results);
  return rows.map((row) => {
    const call = facts.get(`${row.tool}|${row.args_sha256}`);
    return {
      tool: row.tool,
      args_sha256: row.args_sha256,
      row_count: row.row_count,
      refusal: call?.refusal ?? null,
      subject_ref: call?.subjectRef ?? null,
    };
  });
};

const sessionIdFor = (runId: string, itemId: string, repeat: number, modelId: string) =>
  `${EVAL_ACTOR_PREFIX}:${runId}:${itemId}:r${repeat}:${modelId}`;

const skippedLine = (item: Question, repeat: number, spec: ModelSpec): ResultLine => ({
  schema_version: RESULTS_SCHEMA_VERSION,
  item_id: item.id,
  scenario: item.scenario,
  repeat,
  provider: spec.provider,
  model_id: spec.modelId,
  mock: false,
  cache_hit: false,
  model_calls: 0,
  skipped: MISSING_ENV,
  error: null,
  ttft_ms: null,
  total_ms: null,
  tokens: { input: null, output: null, total: null },
  text: null,
  answer_text: null,
  document: null,
  audit: [],
  tool_results: [],
});

const tokenCount = (value: number | undefined): number | null =>
  value === undefined || !Number.isFinite(value) ? null : value;

const runItem = async (
  deps: EvalDeps,
  input: Readonly<{
    runId: string;
    item: Question;
    repeat: number;
    spec: ModelSpec;
    resolved: ResolvedModel;
    replay: boolean;
    timeoutMs: number;
  }>,
): Promise<ResultLine> => {
  const { runId, item, repeat, spec, resolved } = input;
  const cached = createCachedModel({
    model: resolved.model,
    provider: spec.provider,
    modelId: spec.modelId,
    repeat,
    mock: resolved.mock,
    replay: input.replay,
    store: deps.cache,
    onCorrupt: (key) => {
      deps.logError(`[eval] unreadable cache entry ${key}; recording it again`, key);
    },
  });
  const scope: SessionScope = {
    actor: `${EVAL_ACTOR_PREFIX}:${runId}`,
    sessionId: sessionIdFor(runId, item.id, repeat, spec.modelId),
    mode: "synthetic",
  };
  const label = `${item.id} r${repeat} ${spec.modelId}`;
  const startedAt = deps.now();
  const run = await runTurn(
    deps,
    cached.model,
    scope,
    item.question,
    input.timeoutMs,
    label,
  );

  const auditRows = await deps.loadAudit(scope.sessionId).then(
    (rows) => ({ ok: true as const, rows }),
    (error: unknown) => {
      deps.logError(
        `[eval] ${label} could not read the audit rows`,
        error instanceof Error ? error.name : "unknown",
      );
      return { ok: false as const, rows: [] };
    },
  );
  const finished = run.outcome.kind === "finished" ? run.outcome : null;
  const error: ResultError | null =
    run.outcome.kind === "failed"
      ? run.outcome.error
      : !auditRows.ok
        ? "AUDIT_FAILED"
        : finished?.document === null
          ? "DOCUMENT_FAILED"
          : null;
  const stats = cached.stats();

  return {
    schema_version: RESULTS_SCHEMA_VERSION,
    item_id: item.id,
    scenario: item.scenario,
    repeat,
    provider: spec.provider,
    model_id: spec.modelId,
    mock: stats.mock || resolved.mock,
    cache_hit: stats.hits > 0 && stats.misses === 0,
    model_calls: stats.hits + stats.misses,
    skipped: null,
    error,
    ttft_ms:
      run.firstTokenAt === null
        ? null
        : Math.max(0, Math.round(run.firstTokenAt - startedAt)),
    total_ms: Math.max(0, Math.round(run.finishedAt - startedAt)),
    tokens: {
      input: tokenCount(finished?.finish.usage.inputTokens),
      output: tokenCount(finished?.finish.usage.outputTokens),
      total: tokenCount(finished?.finish.usage.totalTokens),
    },
    text: finished?.finish.text ?? null,
    answer_text: finished?.finish.parsed.answerText ?? null,
    document: finished?.document ?? null,
    audit: auditLines(auditRows.rows, finished?.finish.toolResults ?? []),
    tool_results: (finished?.finish.toolResults ?? []).map((result) => ({
      tool: result.toolName,
      input: result.input,
      output: result.output,
    })),
  };
};

type Loaded = Readonly<{
  items: readonly Question[];
  cohortId: string;
  questionsSha256: string;
  answerKeySha256: string;
}>;

/** Fails closed: questions that no longer match the key cannot be scored against it. */
export const loadQuestions = async (
  deps: EvalDeps,
  set: QuestionSetId = "v1",
): Promise<Loaded> => {
  const questionsText = await deps.readText(QUESTION_SETS[set].questions);
  const keyText = await deps.readText(QUESTION_SETS[set].key);
  const raw = JSON.parse(questionsText) as unknown;
  const questions = questionSetSchema.parse(raw);
  const key = answerKeySchema.parse(JSON.parse(keyText) as unknown);
  const sha = questionsSha256(raw);
  if (sha !== key.questions_sha256) {
    throw new EvalSetupError(
      "QUESTIONS_SHA_MISMATCH",
      `questions sha256 ${sha} is not the answer key's ${key.questions_sha256}; rebuild the key (bun run ${set === "v1" ? "eval:answer-key" : "eval:answer-key:s7"})`,
    );
  }
  return {
    items: questions.items,
    cohortId: questions.cohort_id,
    questionsSha256: sha,
    answerKeySha256: sha256Hex(keyText),
  };
};

const missingEnv = (deps: EvalDeps, item: Question): boolean =>
  (item.context.requires ?? []).some((name) => !deps.hasEnv(name));

const progress = (line: ResultLine): string => {
  const state = line.skipped ?? line.error ?? "ok";
  const seconds = line.total_ms === null ? "" : ` ${(line.total_ms / 1000).toFixed(1)}s`;
  const cache = line.cache_hit ? " cache" : "";
  return `${line.item_id} r${line.repeat} ${line.provider}:${line.model_id} ${state}${seconds}${cache}${line.mock ? " MOCK" : ""}\n`;
};

const setup = async (
  options: EvalOptions,
  deps: EvalDeps,
): Promise<
  Readonly<{ loaded: Loaded; items: Question[]; resolved: ResolvedModel[] }>
> => {
  if (deps.dataMode !== "synthetic") {
    throw new EvalSetupError("NOT_SYNTHETIC", "eval runs only with DATA_MODE=synthetic");
  }
  const mismatch = options.models.find((spec) => spec.provider !== deps.llmProvider);
  if (mismatch) {
    throw new EvalSetupError(
      "PROVIDER_MISMATCH",
      `${mismatch.provider}:${mismatch.modelId} is not the configured provider ${deps.llmProvider}; one provider per run`,
    );
  }
  const loaded = await loadQuestions(deps, options.set);
  const items = selectItems(loaded.items, options);
  if (items.length === 0) throw new EvalSetupError("NO_ITEMS", "the selection is empty");
  // Every model is checked before anything runs, so an unlisted id fails in seconds.
  // A replay reaches no endpoint, so it checks nothing.
  if (!options.replay) {
    const listed = await deps.listModels();
    const unlisted = options.models.find((spec) => !listed.includes(spec.modelId));
    if (unlisted) {
      throw new EvalSetupError(
        "MODEL_NOT_LISTED",
        `${unlisted.provider} does not list ${unlisted.modelId} right now`,
      );
    }
  }
  const resolved = await Promise.all(
    options.models.map((spec) =>
      options.replay
        ? Promise.resolve({ model: replayOnlyModel(spec), mock: false, host: null })
        : deps.resolveModel(spec),
    ),
  );
  return { loaded, items, resolved };
};

export const runEval = async (
  argv: readonly string[],
  io: EvalIo,
  deps: EvalDeps,
): Promise<number> => {
  try {
    const options = parseEvalArgs(argv);
    const { loaded, items, resolved } = await setup(options, deps);
    const runId = options.runId ?? deps.newRunId();
    if (!(await deps.prepareRun(runId))) {
      throw new EvalSetupError("RUN_EXISTS", `evaluation/runs/${runId} already exists`);
    }
    if (resolved.some((model) => model.mock)) io.stderr.write(`${MOCK_BANNER}\n`);
    io.stdout.write(
      `Run ${runId}: ${items.length} items × ${options.models.length} models${options.replay ? " (replay)" : ""}\n`,
    );

    const lines: ResultLine[] = [];
    for (const [index, spec] of options.models.entries()) {
      const model = resolved[index];
      if (!model) continue;
      for (const item of items) {
        for (let repeat = 1; repeat <= item.repeat; repeat += 1) {
          const line = missingEnv(deps, item)
            ? skippedLine(item, repeat, spec)
            : await runItem(deps, {
                runId,
                item,
                repeat,
                spec,
                resolved: model,
                replay: options.replay,
                timeoutMs: options.timeoutMs,
              });
          lines.push(line);
          await deps.appendResult(runId, `${JSON.stringify(line)}\n`);
          io.stdout.write(progress(line));
        }
      }
    }

    const skipped = lines.filter((line) => line.skipped !== null);
    const meta: RunMeta = {
      schema_version: META_SCHEMA_VERSION,
      run_id: runId,
      mock: lines.some((line) => line.mock) || resolved.some((model) => model.mock),
      replay: options.replay,
      date: deps.today(),
      git_sha: deps.gitSha(),
      question_set: options.set,
      questions_sha256: loaded.questionsSha256,
      answer_key_sha256: loaded.answerKeySha256,
      cohort_id: loaded.cohortId,
      open_twin_sha: deps.openTwinSha(),
      provider: deps.llmProvider,
      models: options.models.map((spec, index) => ({
        provider: spec.provider,
        model_id: spec.modelId,
        host: resolved[index]?.host ?? null,
      })),
      sampling: "none set",
      platform: deps.platform,
      timeout_ms: options.timeoutMs,
      selection: {
        items: options.items === null ? null : [...options.items],
        scenario: options.scenario,
        latency_set: options.latencySet,
      },
      counts: {
        items: items.length,
        lines: lines.length,
        answered: lines.filter((line) => line.skipped === null && line.error === null)
          .length,
        errors: lines.filter((line) => line.error !== null).length,
        skipped_missing_env: {
          items: [...new Set(skipped.map((line) => line.item_id))],
          lines: skipped.length,
        },
        cache_hits: lines.filter((line) => line.cache_hit).length,
      },
    };
    await deps.writeMeta(runId, `${JSON.stringify(meta, null, 2)}\n`);

    io.stdout.write(
      [
        `Wrote evaluation/runs/${runId}/results.jsonl and meta.json`,
        `Lines ${meta.counts.lines}: answered ${meta.counts.answered}, errors ${meta.counts.errors}, skipped (MISSING_ENV) ${meta.counts.skipped_missing_env.lines}, cache hits ${meta.counts.cache_hits}`,
        "",
      ].join("\n"),
    );
    if (meta.mock) io.stderr.write(`${MOCK_BANNER}\n`);
    return meta.counts.errors === 0 ? 0 : 2;
  } catch (error) {
    if (error instanceof EvalSetupError) {
      io.stderr.write(`${error.message}\n`);
      return 1;
    }
    deps.logError(
      "[eval] the run stopped",
      error instanceof Error ? error.name : "unknown",
    );
    io.stderr.write("The eval run stopped on an unexpected error; see the log above.\n");
    return 1;
  }
};
