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
import type { PastedDataSource } from "../../features/chat/twin-system-prompt";
import { sha256Hex, toCanonicalJson } from "../../packages/audit/hash";
import { isToolRefusal } from "../../packages/query-tools/refusals";
import type { SessionScope } from "../../packages/query-tools/scope";
import { isAgentModelId } from "../../infrastructure/agents";
import type { TurnSkill } from "../../infrastructure/skill-gate";
import type {
  ResponseDocumentV1,
  ResponseToolCall,
} from "../../infrastructure/response-document/document-v1";

import { questionsSha256 } from "./build-answer-key";
import {
  DECLINE_WORDING_IDS,
  DECLINE_WORDINGS,
  type DeclineWordingId,
  declineWordingMeta,
  isDeclineWordingId,
} from "./decline-wordings";
import {
  ARM_ALIASES,
  buildContextBlock,
  type ContextBlock,
  type ContextStats,
  cacheArm,
  contextCalls,
  DEFAULT_CONTEXT_CAP_TOKENS,
  EVAL_ARMS,
  type EvalArm,
  keyedRefusalOutput,
  type PastedCall,
  parseArm,
} from "./context-arm";
import {
  buildFairBlock,
  type FairRead,
  type FairStats,
  type SubjectPick,
  subjectFromQuestion,
} from "./fair-context";
import {
  type CatalogRow,
  type EvalAgent,
  isAgentProblem,
  normalizeAgentSpec,
  resolveEvalAgent,
} from "./eval-agent";
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
  type KeyedTool,
  type KeyEntry,
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

/** The tools of one eval turn and, for an agent's skill, the names its prompt is told. */
export type EvalTurnTools = Readonly<{
  tools: ToolSet;
  offeredTools?: ReadonlySet<string>;
}>;

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
  /**
   * The chat catalog right now: the provider's models (`/v1/models` on the
   * remote GPU) with the agents it offers in front (`fetchChatCatalog`).
   */
  listModels: () => Promise<readonly CatalogRow[]>;
  /** Called once per listed model before any item runs; an agent's base model. */
  resolveModel: (spec: ModelSpec) => Promise<ResolvedModel>;
  /** A skill the server offers (`findRunnableSkill`), for an agent's own skill. */
  findSkill: (name: string) => TurnSkill | null;
  /** The per-item time limit; `AbortSignal.timeout` outside tests. */
  timeoutSignal: (timeoutMs: number) => AbortSignal;
  /** A plain model's tools, or an agent's (`createTurnTools` with its skill and id). */
  createTools: (scope: SessionScope, agent: EvalAgent | null) => EvalTurnTools;
  loadAudit: (sessionId: string) => Promise<readonly ResponseToolCall[]>;
  /**
   * Context arm (#302): one of the key's calls through the real query tool,
   * audited under the item's eval session (`runKeyedTool`).
   */
  runContextCall: (
    scope: SessionScope,
    tool: KeyedTool,
    args: unknown,
  ) => Promise<unknown>;
  /**
   * Fair context arm (#320): the record of the subject the question names,
   * read on the server under the item's eval session. `gate` holds the
   * audited tool calls that checked the subject's scope (and listed the
   * cohort for "the first subject"), for the audit lines.
   */
  readSubjectRecord: (
    scope: SessionScope,
    pick: Exclude<SubjectPick, { kind: "none" }>,
  ) => Promise<Readonly<{ read: FairRead; gate: readonly PastedCall[] }>>;
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
  /** `--decline-wording` (#274); null keeps the chat route's line. */
  declineWording: DeclineWordingId | null;
  /**
   * `tools` (default, the chat route), `context-oracle` (#302: the key's
   * results pasted, no tools; `--arm context` still names it) or
   * `context-fair` (#320: the named subject's record pasted, no tools).
   */
  arm: EvalArm;
  /** Context arm: estimated tokens each item's data block may use. */
  contextCapTokens: number;
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
  "--decline-wording",
  "--arm",
  "--context-cap",
]);
const VALUE_FLAGS = new Set([
  "--set",
  "--models",
  "--items",
  "--scenario",
  "--run-id",
  "--timeout-s",
  "--decline-wording",
  "--arm",
  "--context-cap",
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
  const declineWording = flagValue(args, "--decline-wording");
  if (declineWording !== null && !isDeclineWordingId(declineWording)) {
    throw new EvalSetupError(
      "USAGE",
      `--decline-wording takes one of ${DECLINE_WORDING_IDS.join(", ")}`,
    );
  }
  const arm = parseArm(flagValue(args, "--arm") ?? "tools");
  if (arm === null) {
    throw new EvalSetupError(
      "USAGE",
      `--arm takes one of ${[...EVAL_ARMS, ...Object.keys(ARM_ALIASES)].join(", ")}`,
    );
  }
  const cap = flagValue(args, "--context-cap");
  if (cap !== null && arm === "tools") {
    throw new EvalSetupError(
      "USAGE",
      "--context-cap needs --arm context-oracle or context-fair",
    );
  }
  const contextCapTokens = cap === null ? DEFAULT_CONTEXT_CAP_TOKENS : Number(cap);
  if (!Number.isInteger(contextCapTokens) || contextCapTokens <= 0) {
    throw new EvalSetupError("USAGE", "--context-cap takes a whole number of tokens");
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
    declineWording,
    arm,
    contextCapTokens,
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
  agent: EvalAgent | null,
  scope: SessionScope,
  question: string,
  timeoutMs: number,
  label: string,
  declineWording: DeclineWordingId | null,
  pasted: Readonly<{ text: string; source: PastedDataSource }> | null,
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

    // A context arm has no tools: its rows are in the prompt (#302, #320).
    const { tools, offeredTools } =
      pasted === null
        ? deps.createTools(scope, agent)
        : { tools: {}, offeredTools: new Set<string>() };
    const result = runTwinTurn(
      {
        model,
        tools,
        offeredTools,
        pastedData: pasted?.text ?? null,
        ...(pasted === null ? {} : { pastedDataSource: pasted.source }),
        mode: "synthetic",
        // As the chat route: the agent's skill (none typed) and its role line.
        skill: agent?.skill ?? null,
        agent: agent?.agent ?? null,
        ...(declineWording === null
          ? {}
          : { declineRule: DECLINE_WORDINGS[declineWording] }),
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
    agent: EvalAgent | null;
    replay: boolean;
    timeoutMs: number;
    declineWording: DeclineWordingId | null;
    arm: EvalArm;
    contextCapTokens: number;
    keyEntries: readonly KeyEntry[];
  }>,
): Promise<ResultLine> => {
  const { runId, item, repeat, spec, resolved, agent } = input;
  // The key names the model that answers; an agent's prompt (role line, skill,
  // tools) differs from its base model's, so the two never share an entry.
  const cached = createCachedModel({
    model: resolved.model,
    provider: spec.provider,
    modelId: agent?.agent.baseModelId ?? spec.modelId,
    repeat,
    arm: cacheArm(input.arm),
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
  const context: PastedBlock | null =
    input.arm === "tools"
      ? null
      : await (
          input.arm === "context-oracle"
            ? pasteContext(deps, scope, input.keyEntries, input.contextCapTokens).then(
                (block): PastedBlock => ({ ...block, gate: [], fair: null }),
              )
            : pasteFairContext(deps, scope, item.question, input.contextCapTokens)
        ).catch((error: unknown) => {
          deps.logError(
            `[eval] ${label} could not read the rows for the data block`,
            error instanceof Error ? error.name : "unknown",
          );
          return null;
        });
  if (input.arm !== "tools" && context === null) {
    return { ...failedLine(item, repeat, spec, resolved.mock), error: "CONTEXT_FAILED" };
  }
  const startedAt = deps.now();
  const run = await runTurn(
    deps,
    cached.model,
    agent,
    scope,
    item.question,
    input.timeoutMs,
    label,
    input.declineWording,
    context === null
      ? null
      : {
          text: context.text,
          source: input.arm === "context-fair" ? "subject-record" : "key-calls",
        },
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
    ...(context === null
      ? {
          audit: auditLines(auditRows.rows, finished?.finish.toolResults ?? []),
          tool_results: (finished?.finish.toolResults ?? []).map((result) => ({
            tool: result.toolName,
            input: result.input,
            output: result.output,
          })),
        }
      : {
          // The server's reads: what the model was given, as its sources (#302).
          audit: auditLines(
            auditRows.rows,
            asTurnResults([...context.gate, ...context.pasted]),
          ),
          tool_results: finished === null ? [] : [...context.pasted],
          arm:
            input.arm === "context-fair"
              ? ("context-fair" as const)
              : ("context-oracle" as const),
          context: context.stats,
          ...(context.fair === null
            ? {}
            : { fair: { ...context.fair, codes_cut: [...context.fair.codes_cut] } }),
        }),
  };
};

const asTurnResults = (pasted: readonly PastedCall[]): TwinTurnToolResult[] =>
  pasted.map((call) => ({ toolName: call.tool, input: call.input, output: call.output }));

/**
 * The context arm's data block (#302): the key's distinct calls run through
 * the real tools under this item's eval session, then cut to the cap.
 */
export const pasteContext = async (
  deps: Pick<EvalDeps, "runContextCall">,
  scope: SessionScope,
  entries: readonly KeyEntry[],
  capTokens: number,
): Promise<ContextBlock> => {
  const results: PastedCall[] = [];
  // One at a time, so the audit rows keep the key's order.
  for (const call of contextCalls(entries)) {
    const output =
      call.keyedRefusal === null
        ? await deps.runContextCall(scope, call.tool, call.args)
        : keyedRefusalOutput(call.keyedRefusal);
    results.push({ tool: call.tool, input: call.args, output });
  }
  return buildContextBlock(results, capTokens);
};

/** A data block either context arm pasted, with what the fair arm records. */
type PastedBlock = Readonly<{
  text: string;
  pasted: readonly PastedCall[];
  stats: ContextStats;
  /** Audited calls that are not in the block (the fair arm's scope check). */
  gate: readonly PastedCall[];
  fair: FairStats | null;
}>;

/**
 * The fair arm's data block (#320): the subject the question names, its
 * record read on the server, laid out by `buildFairBlock`. The key is not
 * read.
 */
export const pasteFairContext = async (
  deps: Pick<EvalDeps, "readSubjectRecord">,
  scope: SessionScope,
  question: string,
  capTokens: number,
): Promise<PastedBlock> => {
  const pick = subjectFromQuestion(question);
  const { read, gate } =
    pick.kind === "none"
      ? { read: { kind: "no-subject" } as const, gate: [] }
      : await deps.readSubjectRecord(scope, pick);
  const block = buildFairBlock(read, capTokens);
  return { ...block, gate };
};

/** A line that never reached the model. */
const failedLine = (
  item: Question,
  repeat: number,
  spec: ModelSpec,
  mock: boolean,
): ResultLine => ({ ...skippedLine(item, repeat, spec), mock, skipped: null });

type Loaded = Readonly<{
  items: readonly Question[];
  entries: Readonly<Record<string, readonly KeyEntry[]>>;
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
      `questions sha256 ${sha} is not the answer key's ${key.questions_sha256}; rebuild the key (bun run ${set === "v1" ? "eval:answer-key" : `eval:answer-key:${set}`})`,
    );
  }
  return {
    items: questions.items,
    entries: key.entries,
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
  Readonly<{
    loaded: Loaded;
    items: Question[];
    models: readonly ModelSpec[];
    resolved: ResolvedModel[];
    agents: readonly (EvalAgent | null)[];
  }>
> => {
  if (deps.dataMode !== "synthetic") {
    throw new EvalSetupError("NOT_SYNTHETIC", "eval runs only with DATA_MODE=synthetic");
  }
  const models = options.models.map((spec) => normalizeAgentSpec(spec, deps.llmProvider));
  const mismatch = models.find((spec) => spec.provider !== deps.llmProvider);
  if (mismatch) {
    throw new EvalSetupError(
      "PROVIDER_MISMATCH",
      `${mismatch.provider}:${mismatch.modelId} is not the configured provider ${deps.llmProvider}; one provider per run`,
    );
  }
  if (options.arm !== "tools" && models.some((spec) => isAgentModelId(spec.modelId))) {
    throw new EvalSetupError(
      "USAGE",
      `--arm ${options.arm} gives the model no tools, so an agent's skill has none to cut; run its base model`,
    );
  }
  const loaded = await loadQuestions(deps, options.set);
  const items = selectItems(loaded.items, options);
  if (items.length === 0) throw new EvalSetupError("NO_ITEMS", "the selection is empty");
  // Every model is checked before anything runs, so an unlisted id fails in seconds.
  // A replay reaches no model; it reads the catalog only to resolve an agent.
  const hasAgent = models.some((spec) => isAgentModelId(spec.modelId));
  const catalog = !options.replay || hasAgent ? await deps.listModels() : [];
  if (!options.replay) {
    const unlisted = models.find(
      (spec) =>
        !isAgentModelId(spec.modelId) && !catalog.some((row) => row.id === spec.modelId),
    );
    if (unlisted) {
      throw new EvalSetupError(
        "MODEL_NOT_LISTED",
        `${unlisted.provider} does not list ${unlisted.modelId} right now`,
      );
    }
  }
  const agents = models.map((spec) => {
    if (!isAgentModelId(spec.modelId)) return null;
    const agent = resolveEvalAgent(spec.modelId, catalog, deps.findSkill);
    if (isAgentProblem(agent)) throw new EvalSetupError(agent.code, agent.message);
    return agent;
  });
  const resolved = await Promise.all(
    models.map((spec, index) => {
      const base = { ...spec, modelId: agents[index]?.agent.baseModelId ?? spec.modelId };
      return options.replay
        ? Promise.resolve({ model: replayOnlyModel(base), mock: false, host: null })
        : deps.resolveModel(base);
    }),
  );
  return { loaded, items, models, resolved, agents };
};

/** What meta.json records about an agent run (#279); nothing for a plain model. */
export const agentMeta = (
  agent: EvalAgent | null,
): Pick<RunMeta["models"][number], "agent"> =>
  agent === null
    ? {}
    : {
        agent: {
          id: agent.agent.id,
          name: agent.agent.name,
          base_model_id: agent.agent.baseModelId,
          skill: agent.agent.skill,
          rules_sha256: agent.rulesSha256,
          roster_sha256: agent.rosterSha256,
        },
      };

export const runEval = async (
  argv: readonly string[],
  io: EvalIo,
  deps: EvalDeps,
): Promise<number> => {
  try {
    const options = parseEvalArgs(argv);
    const { loaded, items, models, resolved, agents } = await setup(options, deps);
    const runId = options.runId ?? deps.newRunId();
    if (!(await deps.prepareRun(runId))) {
      throw new EvalSetupError("RUN_EXISTS", `evaluation/runs/${runId} already exists`);
    }
    if (resolved.some((model) => model.mock)) io.stderr.write(`${MOCK_BANNER}\n`);
    io.stdout.write(
      `Run ${runId}: ${items.length} items × ${models.length} models, arm ${options.arm}${options.replay ? " (replay)" : ""}\n`,
    );

    const lines: ResultLine[] = [];
    for (const [index, spec] of models.entries()) {
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
                agent: agents[index] ?? null,
                replay: options.replay,
                timeoutMs: options.timeoutMs,
                declineWording: options.declineWording,
                arm: options.arm,
                contextCapTokens: options.contextCapTokens,
                keyEntries: loaded.entries[item.id] ?? [],
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
      models: models.map((spec, index) => ({
        provider: spec.provider,
        model_id: spec.modelId,
        host: resolved[index]?.host ?? null,
        ...agentMeta(agents[index] ?? null),
      })),
      arm: options.arm,
      ...(options.arm !== "tools"
        ? {
            context: {
              cap_tokens: options.contextCapTokens,
              items_truncated: new Set(
                lines.filter((line) => line.context?.truncated).map((l) => l.item_id),
              ).size,
              lines_over_cap: lines.filter(
                (line) =>
                  line.context !== undefined &&
                  line.context.tokens > line.context.cap_tokens,
              ).length,
            },
          }
        : {}),
      sampling: "none set",
      platform: deps.platform,
      timeout_ms: options.timeoutMs,
      ...(options.declineWording === null
        ? {}
        : { decline_wording: declineWordingMeta(options.declineWording) }),
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
