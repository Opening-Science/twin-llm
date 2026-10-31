/**
 * The oracle data-in-prompt arm of the eval harness (#302): `bun run eval --
 * --arm context-oracle` (`context` is its old name and still works). For each item the server runs the calls the answer key expects,
 * through the same audited query tools the model would call, and the model
 * gets their results as a delimited data block in the system prompt and no
 * tools. The default arm, `tools`, is the chat route as it is.
 *
 * This is the "oracle paste" of the P1 plan: the block holds exactly what the
 * key's calls return (summaries, refusals and rows), so the arm separates
 * choosing and calling a tool from reading its result. Rows are cut to fit
 * `capTokens` (the same conservative estimate as the prompt budget test) and
 * the cut is recorded. Pure; the caller runs the tools.
 */
import {
  JSON_CHARS_PER_TOKEN,
  estimateTokens,
} from "../../infrastructure/ollama-context";
import { isToolRefusal } from "../../packages/query-tools/refusals";
import { sha256Hex, toCanonicalJson } from "../../packages/audit/hash";

import type { KeyedTool, KeyEntry } from "./question-set";

/**
 * How the model gets the data: `tools` (the chat route), `context-oracle`
 * (#302: the key's call results pasted), `context-fair` (#320: the named
 * subject's record pasted, chosen without the key; `fair-context.ts`) or
 * `code` (#303: that record as a file, read by programs the model writes and
 * the sandbox runs; `code-arm.ts`).
 */
export const EVAL_ARMS = ["tools", "context-oracle", "context-fair", "code"] as const;

export type EvalArm = (typeof EVAL_ARMS)[number];

/** `context`, the #302 name of the oracle arm, still names it, so its run ids and commands keep working. */
export const ARM_ALIASES: Readonly<Record<string, EvalArm>> = {
  context: "context-oracle",
};

/** Every arm a run file may record: the four, and `context` from runs before #320. */
export const RECORDED_ARMS = [...EVAL_ARMS, "context"] as const;

export type RecordedArm = (typeof RECORDED_ARMS)[number];

/** The arm a `--arm` value names, aliases resolved; null for none. */
export const parseArm = (value: string): EvalArm | null =>
  (EVAL_ARMS as readonly string[]).includes(value)
    ? (value as EvalArm)
    : (ARM_ALIASES[value] ?? null);

export const isEvalArm = (value: string): value is EvalArm =>
  (EVAL_ARMS as readonly string[]).includes(value);

/**
 * An arm where the server reads the rows: the data-in-prompt arms (no tools)
 * and the code arm (only `run_python`, over a file the server wrote).
 */
export const isContextArm = (arm: RecordedArm | undefined): boolean =>
  arm !== undefined && arm !== "tools";

/**
 * The arm as the cache key names it. The oracle arm keeps `context`, its
 * #302 name, so a call identical to one recorded then is answered from it.
 */
export type CacheArm = "tools" | "context" | "context-fair" | "code";

export const cacheArm = (arm: EvalArm): CacheArm =>
  arm === "context-oracle" ? "context" : arm;

/**
 * Estimated tokens the block may use. The context arm sends no tool
 * definitions (several thousand tokens in the tools arm), so this fits the
 * 16k context next to the system prompt and the turn reserve.
 */
export const DEFAULT_CONTEXT_CAP_TOKENS = 6_000;

/** One call the server runs for the block. */
export type ContextCall = Readonly<{
  tool: KeyedTool;
  args: Readonly<Record<string, unknown>>;
  /** Set for a call the key built in personal mode: the key's refusal, not run here. */
  keyedRefusal: string | null;
}>;

/** A call with its result, as the model saw it (rows cut to the cap). */
export type PastedCall = Readonly<{ tool: string; input: unknown; output: unknown }>;

export type ContextStats = Readonly<{
  calls: number;
  /** Rows (objects in a list) the calls returned. */
  rows_total: number;
  /** Rows the block holds. */
  rows_pasted: number;
  truncated: boolean;
  /** Estimated tokens of the block. */
  tokens: number;
  cap_tokens: number;
}>;

export type ContextBlock = Readonly<{
  text: string;
  pasted: readonly PastedCall[];
  stats: ContextStats;
}>;

/** The key's distinct calls, in key order: several values often read one call. */
export const contextCalls = (entries: readonly KeyEntry[]): ContextCall[] => {
  const seen = new Set<string>();
  return entries.flatMap((entry) => {
    const id = sha256Hex(
      toCanonicalJson({ tool: entry.tool, args: entry.args, mode: entry.mode ?? null }),
    );
    if (seen.has(id)) return [];
    seen.add(id);
    return [
      {
        tool: entry.tool,
        args: entry.args,
        keyedRefusal: entry.mode === "personal" ? entry.refusal : null,
      },
    ];
  });
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isRowList = (value: unknown): value is Record<string, unknown>[] =>
  Array.isArray(value) && value.length > 0 && value.every(isPlainObject);

/** Rows in every list of objects, at any depth (rows inside kept rows too). */
export const countRows = (value: unknown): number => {
  if (isRowList(value)) {
    return value.length + value.reduce((sum, row) => sum + countRows(row), 0);
  }
  if (Array.isArray(value))
    return value.reduce((sum: number, v) => sum + countRows(v), 0);
  if (isPlainObject(value)) {
    return Object.values(value).reduce((sum: number, v) => sum + countRows(v), 0);
  }
  return 0;
};

/** The longest list of objects anywhere in `value`. */
const longestRowList = (value: unknown): number => {
  const own = isRowList(value) ? value.length : 0;
  const inner = Array.isArray(value)
    ? value.map(longestRowList)
    : isPlainObject(value)
      ? Object.values(value).map(longestRowList)
      : [];
  return Math.max(own, ...inner);
};

/** Every list of objects cut to its first `keep` rows; nothing else changes. */
export const keepRows = (value: unknown, keep: number): unknown => {
  if (isRowList(value)) return value.slice(0, keep).map((row) => keepRows(row, keep));
  if (Array.isArray(value)) return value.map((v) => keepRows(v, keep));
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [key, keepRows(v, keep)]),
    );
  }
  return value;
};

const PLAIN_TEXT = /^[\w.:+\-/[\]%°µ]+$/u;

/** A scalar as it goes in the block: numbers in full, text quoted when it has spaces. */
export const cell = (value: unknown): string => {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string")
    return PLAIN_TEXT.test(value) ? value : JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
};

type Flat = Readonly<{
  pairs: readonly string[];
  tables: readonly Readonly<{ name: string; columns: string[]; rows: string[][] }>[];
}>;

/** `key=value` pairs with dotted keys; lists of objects become tables. */
const flatten = (value: unknown, prefix: string): Flat => {
  if (isRowList(value)) {
    const flatRows = value.map((row) => flatten(row, ""));
    const columns = [
      ...new Set(
        flatRows.flatMap((row) => row.pairs.map((pair) => pair.split("=")[0] ?? "")),
      ),
    ];
    const rows = flatRows.map((row) => {
      const byKey = new Map(
        row.pairs.map((pair) => {
          const at = pair.indexOf("=");
          return [pair.slice(0, at), pair.slice(at + 1)] as const;
        }),
      );
      return columns.map((column) => byKey.get(column) ?? "");
    });
    return {
      pairs: [],
      tables: [
        { name: prefix || "rows", columns, rows },
        ...flatRows.flatMap((row) => row.tables),
      ],
    };
  }
  if (isPlainObject(value)) {
    const parts = Object.entries(value).map(([key, inner]) =>
      flatten(inner, prefix === "" ? key : `${prefix}.${key}`),
    );
    return {
      pairs: parts.flatMap((part) => part.pairs),
      tables: parts.flatMap((part) => part.tables),
    };
  }
  if (Array.isArray(value)) {
    return {
      pairs: [`${prefix || "value"}=[${value.map(cell).join(", ")}]`],
      tables: [],
    };
  }
  return { pairs: [`${prefix || "value"}=${cell(value)}`], tables: [] };
};

const callHeading = (index: number, call: PastedCall): string =>
  `[${index + 1}] ${call.tool}(${
    isPlainObject(call.input)
      ? Object.entries(call.input)
          .map(([key, value]) => `${key}=${cell(value)}`)
          .join(", ")
      : cell(call.input)
  })`;

/** One call's result as compact text: a refusal line, `key=value` lines and row tables. */
export const callText = (index: number, call: PastedCall, totalRows: number): string => {
  const shown = countRows(call.output);
  const head = isToolRefusal(call.output)
    ? `refused: ${call.output.code}`
    : totalRows === 0 && readNothing(call.output)
      ? "no rows"
      : null;
  const flat = flatten(call.output, "");
  return [
    callHeading(index, call),
    ...(head === null ? [] : [head]),
    ...(flat.pairs.length > 0 ? [flat.pairs.join(" ")] : []),
    ...flat.tables.flatMap((tableOf) => [
      `${tableOf.name}:`,
      tableOf.columns.join(" | "),
      ...tableOf.rows.map((row) => row.join(" | ")),
    ]),
    ...(shown < totalRows
      ? [`(rows cut to fit the prompt: ${shown} of ${totalRows} shown)`]
      : []),
  ].join("\n");
};

/** A result with `n: 0` or an empty list (`rows: []`) read nothing. */
export const readNothing = (value: unknown): boolean =>
  Array.isArray(value)
    ? value.length === 0
    : isPlainObject(value) &&
      (value.n === 0 ||
        Object.values(value).some((inner) => Array.isArray(inner) && inner.length === 0));

export const NO_CALLS_TEXT =
  "No rows were read for this question: the answer key expects no read of subject data.";

export const BLOCK_START = "<data>";
export const BLOCK_END = "</data>";

const render = (
  results: readonly PastedCall[],
  keep: number,
): Readonly<{ text: string; pasted: PastedCall[] }> => {
  const pasted = results.map((call) => ({
    ...call,
    output: keepRows(call.output, keep),
  }));
  const body =
    pasted.length === 0
      ? NO_CALLS_TEXT
      : pasted
          .map((call, index) => callText(index, call, countRows(results[index]?.output)))
          .join("\n\n");
  return { text: [BLOCK_START, body, BLOCK_END].join("\n"), pasted };
};

const tokensOf = (text: string): number => estimateTokens(text, JSON_CHARS_PER_TOKEN);

/**
 * The block for one item. With every row it fits, it is used as is; else each
 * list keeps the most rows (the same number for every list, from the top)
 * that fit `capTokens`. When even no rows do not fit, the block goes over the
 * cap and says so in `stats` (`tokens` above `cap_tokens`).
 */
export const buildContextBlock = (
  results: readonly PastedCall[],
  capTokens: number,
): ContextBlock => {
  const rowsTotal = results.reduce((sum, call) => sum + countRows(call.output), 0);
  const longest = Math.max(0, ...results.map((call) => longestRowList(call.output)));
  const fits = (keep: number) => tokensOf(render(results, keep).text) <= capTokens;
  let keep = longest;
  if (!fits(longest)) {
    let low = 0;
    let high = longest - 1;
    keep = 0;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (fits(mid)) {
        keep = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
  }
  const { text, pasted } = render(results, keep);
  const rowsPasted = pasted.reduce((sum, call) => sum + countRows(call.output), 0);
  return {
    text,
    pasted,
    stats: {
      calls: results.length,
      rows_total: rowsTotal,
      rows_pasted: rowsPasted,
      truncated: rowsPasted < rowsTotal,
      tokens: tokensOf(text),
      cap_tokens: capTokens,
    },
  };
};

/** A call the key built in personal mode is not run: its refusal goes in as the key holds it. */
export const keyedRefusalOutput = (
  code: string,
): Readonly<{ code: string; error: string }> => ({
  code,
  error: "refused in personal mode, as the answer key records it",
});
