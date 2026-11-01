/**
 * The code arm of the eval harness (#303): `bun run eval -- --arm code`.
 * The model gets one tool, `run_python`, and computes its numbers by writing
 * a program over a table of the subject's rows, which runs in the sandbox of
 * `code-sandbox.ts`. Its answer is scored by the same scorers as the other
 * arms.
 *
 * The table is the record of the subject the question names, chosen exactly
 * as the fair arm chooses it (#320, `subjectFromQuestion` and
 * `readFairRecord`), never from the answer key: every numeric observation
 * the warehouse holds for that subject (the rows the query tools read),
 * its conditions and its medication requests, as one JSON file. The prompt
 * gets the file's layout and the list of observation codes with their count
 * and first and last date, but no readings: the numbers come from code.
 *
 * Each item may run 1 + `MAX_CODE_RETRIES` programs; a further call is
 * refused. Every run is recorded: the code, how it ended, stdout and stderr
 * (capped). Pure, except `createRunPythonTool`, which calls the sandbox port.
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod";

import {
  JSON_CHARS_PER_TOKEN,
  estimateTokens,
} from "../../infrastructure/ollama-context";
import { modelInputSchema } from "../../packages/query-tools/model-schema";

import {
  BLOCK_END,
  BLOCK_START,
  cell,
  type ContextStats,
  type PastedCall,
} from "./context-arm";
import {
  type CodeSummary,
  codeSummaries,
  type FairRead,
  RECORD_TOOL,
} from "./fair-context";
import {
  type CODE_RUN_ERRORS,
  SANDBOX_INPUT_PATH,
  type SandboxResult,
} from "./code-sandbox";

/** The tool the model calls. */
export const RUN_PYTHON_TOOL = "run_python";

/** Runs after the first one; fixed before any run (#303). */
export const MAX_CODE_RETRIES = 2;
export const MAX_CODE_RUNS = 1 + MAX_CODE_RETRIES;

/** The refusal of a run past the limit. */
export const CODE_RUN_LIMIT = "CODE_RUN_LIMIT";

/** Longest program accepted, in characters. */
export const MAX_CODE_CHARS = 20_000;

/** The exported table: one JSON file at `SANDBOX_INPUT_PATH`. */
export type CodeTable = Readonly<{
  subject_ref: string | null;
  /** Set when the subject's read was refused; the lists are then empty. */
  refusal: string | null;
  observations: readonly Readonly<{
    date: string;
    loinc: string;
    display: string;
    value: number;
    unit: string;
  }>[];
  conditions: readonly Readonly<{
    onset: string | null;
    abatement: string | null;
    status: string | null;
    code: string;
    display: string;
  }>[];
  medications: readonly Readonly<{
    authored: string | null;
    status: string | null;
    code: string;
    display: string;
    dosage: string | null;
  }>[];
}>;

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The table for one item: oldest first, as the warehouse holds it. */
export const codeTable = (read: FairRead): CodeTable => {
  if (read.kind !== "record") {
    return {
      subject_ref: read.kind === "refused" ? read.subjectRef : null,
      refusal: read.kind === "refused" ? read.code : null,
      observations: [],
      conditions: [],
      medications: [],
    };
  }
  const { record } = read;
  return {
    subject_ref: record.subjectRef,
    refusal: null,
    observations: [...record.observations]
      .sort((a, b) => byText(a.at, b.at) || byText(a.loinc, b.loinc) || a.value - b.value)
      .map((row) => ({
        date: row.at,
        loinc: row.loinc,
        display: row.display,
        value: row.value,
        unit: row.unit,
      })),
    conditions: [...record.conditions]
      .sort((a, b) => byText(a.onset ?? "", b.onset ?? "") || byText(a.code, b.code))
      .map((row) => ({
        onset: row.onset,
        abatement: row.abatement,
        status: row.status,
        code: row.code,
        display: row.display,
      })),
    medications: [...record.medications]
      .sort(
        (a, b) => byText(a.authored ?? "", b.authored ?? "") || byText(a.code, b.code),
      )
      .map((row) => ({
        authored: row.authored,
        status: row.status,
        code: row.code,
        display: row.display,
        dosage: row.dosage,
      })),
  };
};

export const NO_SUBJECT_TABLE_TEXT =
  "No subject is named in the question, so the file holds no rows (subject_ref null, empty lists).";

const day = (iso: string): string => iso.slice(0, 10);

const codeLine = (index: number, code: CodeSummary): string =>
  `[${index + 1}] ${code.loinc} ${cell(code.display)} unit=${cell(code.unit)} n=${code.n} first=${day(code.first)} last=${day(code.last)}`;

const LAYOUT_LINES: readonly string[] = [
  `The file ${SANDBOX_INPUT_PATH} is JSON with these keys:`,
  '- "subject_ref": the subject; "refusal": null, or the code when the read was refused',
  '- "observations": list of {"date": ISO-8601 instant, "loinc", "display", "value" (number), "unit" (UCUM)}, oldest first',
  '- "conditions": list of {"onset", "abatement", "status", "code", "display"}, dates ISO-8601 or null, oldest onset first',
  '- "medications": list of {"authored", "status", "code", "display", "dosage"}, oldest first',
];

/** Per item: the subject and what the file holds (#303). */
export type CodeTableStats = Readonly<{
  subject_ref: string | null;
  refusal: string | null;
  observations: number;
  conditions: number;
  medications: number;
  codes_total: number;
  /** Codes named in the prompt's list; the rest are only in the file. */
  codes_listed: number;
}>;

export type CodeBlock = Readonly<{
  text: string;
  /** The listed code summaries, as `subject_record` results with no readings. */
  pasted: readonly PastedCall[];
  stats: ContextStats;
  table: CodeTableStats;
}>;

const tokensOf = (text: string): number => estimateTokens(text, JSON_CHARS_PER_TOKEN);

/**
 * The prompt's block: the file's layout and the observation codes, newest
 * reading first, listed until the next would pass `capTokens` (the file
 * always holds every row). No readings are in the block.
 */
export const buildCodeBlock = (table: CodeTable, capTokens: number): CodeBlock => {
  const codes = codeSummaries(
    table.observations.map((row) => ({
      loinc: row.loinc,
      display: row.display,
      unit: row.unit,
      value: row.value,
      at: row.date,
    })),
    0,
  );
  const heading =
    table.refusal !== null
      ? `subject_record(subject_ref=${cell(table.subject_ref)})\nrefused: ${table.refusal}\nThe file holds no rows.`
      : table.subject_ref === null
        ? NO_SUBJECT_TABLE_TEXT
        : `subject_ref=${cell(table.subject_ref)}: ${table.observations.length} observations (${codes.length} codes), ${table.conditions.length} conditions, ${table.medications.length} medication requests in the file.`;
  const render = (listed: number): string => {
    const cut = codes.length - listed;
    return [
      BLOCK_START,
      heading,
      ...LAYOUT_LINES,
      ...(codes.length > 0
        ? [
            "Observation codes in the file, newest reading first (no readings shown):",
            ...codes.slice(0, listed).map((code, index) => codeLine(index, code)),
          ]
        : []),
      ...(cut > 0
        ? [
            `(${cut} older codes are in the file but not listed: ${codes
              .slice(listed)
              .map((code) => code.loinc)
              .join(", ")})`,
          ]
        : []),
      BLOCK_END,
    ].join("\n");
  };
  let listed = 0;
  while (listed < codes.length && tokensOf(render(listed + 1)) <= capTokens) {
    listed += 1;
  }
  const text = render(listed);
  const pasted: PastedCall[] = codes.slice(0, listed).map((code) => ({
    tool: RECORD_TOOL,
    input: { subject_ref: table.subject_ref, loinc: code.loinc },
    output: {
      loinc: code.loinc,
      display: code.display,
      unit: code.unit,
      n: code.n,
      first: day(code.first),
      last: day(code.last),
    },
  }));
  return {
    text,
    pasted,
    stats: {
      calls: pasted.length,
      rows_total:
        table.observations.length + table.conditions.length + table.medications.length,
      rows_pasted: 0,
      truncated: listed < codes.length,
      tokens: tokensOf(text),
      cap_tokens: capTokens,
    },
    table: {
      subject_ref: table.subject_ref,
      refusal: table.refusal,
      observations: table.observations.length,
      conditions: table.conditions.length,
      medications: table.medications.length,
      codes_total: codes.length,
      codes_listed: listed,
    },
  };
};

/** Why a run did not give a usable result; null when it exited 0 and printed. */
export type CodeRunError = (typeof CODE_RUN_ERRORS)[number];

export const codeRunError = (result: SandboxResult): CodeRunError | null => {
  if (result.signal === "SPAWN_FAILED") return "SANDBOX_FAILED";
  if (result.timedOut) return "TIMEOUT";
  if (result.outputCapped) return "OUTPUT_CAP";
  if (result.exitCode === null) return "KILLED";
  if (result.exitCode !== 0) return "EXIT_NONZERO";
  if (result.stdout.trim().length === 0) return "NO_OUTPUT";
  return null;
};

/** One run as the results line records it. */
export type CodeRun = Readonly<{
  code: string;
  error: CodeRunError | null;
  exit_code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  stdout_truncated: boolean;
  stderr_truncated: boolean;
  ms: number;
}>;

export const codeRunOf = (code: string, result: SandboxResult): CodeRun => ({
  code,
  error: codeRunError(result),
  exit_code: result.exitCode,
  signal: result.signal,
  stdout: result.stdout,
  stderr: result.stderr,
  stdout_truncated: result.stdoutTruncated,
  stderr_truncated: result.stderrTruncated,
  ms: result.ms,
});

/** What the model sees for a run: its output and how it ended, nothing about the host. */
export const runOutput = (run: CodeRun, runsLeft: number) => ({
  ok: run.error === null,
  error: run.error,
  exit_code: run.exit_code,
  stdout: run.stdout,
  ...(run.stdout_truncated ? { stdout_truncated: true } : {}),
  stderr: run.stderr,
  ...(run.stderr_truncated ? { stderr_truncated: true } : {}),
  runs_left: runsLeft,
});

export const runLimitOutput = () => ({
  code: CODE_RUN_LIMIT,
  error: `at most ${MAX_CODE_RUNS} programs per question; answer from the runs you have`,
});

/** The per-item record of the code arm (#303). */
export type CodeArmRecord = Readonly<{
  table: CodeTableStats;
  runs: readonly CodeRun[];
  /** Runs after the first, at most `MAX_CODE_RETRIES`. */
  retries: number;
  /** The model asked for a run past the limit and was refused. */
  limit_hit: boolean;
}>;

export const codeArmRecord = (
  table: CodeTableStats,
  runs: readonly CodeRun[],
  refusedCalls: number,
): CodeArmRecord => ({
  table,
  runs: [...runs],
  retries: Math.max(0, runs.length - 1),
  limit_hit: refusedCalls > 0,
});

export const RUN_PYTHON_DESCRIPTION = `Runs a Python 3 program (standard library only: json, csv, statistics, math, datetime; no network, no other files) over the subject's record at ${SANDBOX_INPUT_PATH}. Print every number you will report, with its LOINC code, unit and dates. Returns stdout and stderr. At most ${MAX_CODE_RUNS} programs per question; fix and run again when one fails.`;

export const runPythonInput = z
  .object({
    code: z
      .string()
      .min(1)
      .max(MAX_CODE_CHARS)
      .describe("The whole Python program; it reads the JSON file and prints results."),
  })
  .strict();

/** Collects the item's runs as the tool executes them. */
export type CodeRunLog = Readonly<{
  runs: () => readonly CodeRun[];
  refusedCalls: () => number;
}>;

/**
 * The turn's only tool. Each call runs one program in the item's sandbox
 * session; past `MAX_CODE_RUNS` it returns `CODE_RUN_LIMIT` without running.
 */
export const createRunPythonTool = (
  run: (code: string) => Promise<SandboxResult>,
): Readonly<{ tools: ToolSet; log: CodeRunLog }> => {
  const runs: CodeRun[] = [];
  let refused = 0;
  let started = 0;
  return {
    tools: {
      [RUN_PYTHON_TOOL]: tool({
        description: RUN_PYTHON_DESCRIPTION,
        inputSchema: modelInputSchema(runPythonInput),
        execute: async ({ code }) => {
          if (started >= MAX_CODE_RUNS) {
            refused += 1;
            return runLimitOutput();
          }
          started += 1;
          const record = codeRunOf(code, await run(code));
          runs.push(record);
          return runOutput(record, MAX_CODE_RUNS - started);
        },
      }),
    },
    log: { runs: () => [...runs], refusedCalls: () => refused },
  };
};
