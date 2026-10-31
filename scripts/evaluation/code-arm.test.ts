import { describe, expect, test } from "bun:test";

import {
  buildCodeBlock,
  CODE_RUN_LIMIT,
  codeArmRecord,
  codeRunError,
  codeRunOf,
  codeTable,
  createRunPythonTool,
  MAX_CODE_RUNS,
  NO_SUBJECT_TABLE_TEXT,
  runOutput,
  RUN_PYTHON_TOOL,
} from "./code-arm";
import type { SandboxResult } from "./code-sandbox";
import type { FairRead } from "./fair-context";

/** Made-up synthetic rows. */
const SUBJECT = "00000000-0000-4000-8000-0000000000aa";
const READ: FairRead = {
  kind: "record",
  record: {
    subjectRef: SUBJECT,
    observations: [
      {
        loinc: "4548-4",
        display: "Hemoglobin A1c",
        unit: "%",
        value: 6.1,
        at: "2025-06-01T00:00:00.000Z",
      },
      {
        loinc: "29463-7",
        display: "Body Weight",
        unit: "kg",
        value: 81.5,
        at: "2024-01-01T00:00:00.000Z",
      },
      {
        loinc: "4548-4",
        display: "Hemoglobin A1c",
        unit: "%",
        value: 5.9,
        at: "2024-02-01T00:00:00.000Z",
      },
    ],
    conditions: [
      {
        code: "44054006",
        display: "Diabetes",
        onset: "2020-01-01T00:00:00.000Z",
        abatement: null,
        status: "active",
      },
    ],
    medications: [],
  },
};

const ok = (over: Partial<SandboxResult> = {}): SandboxResult => ({
  exitCode: 0,
  signal: null,
  timedOut: false,
  outputCapped: false,
  stdout: "4548-4 mean 6.0 %\n",
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
  ms: 30,
  ...over,
});

describe("codeTable", () => {
  test("every row of the record, oldest first, nothing chosen", () => {
    const table = codeTable(READ);
    expect(table.subject_ref).toBe(SUBJECT);
    expect(table.refusal).toBeNull();
    expect(table.observations.map((row) => [row.date.slice(0, 10), row.value])).toEqual([
      ["2024-01-01", 81.5],
      ["2024-02-01", 5.9],
      ["2025-06-01", 6.1],
    ]);
    expect(table.conditions).toEqual([
      {
        onset: "2020-01-01T00:00:00.000Z",
        abatement: null,
        status: "active",
        code: "44054006",
        display: "Diabetes",
      },
    ]);
  });

  test("a refused or unnamed subject gives empty lists", () => {
    expect(
      codeTable({ kind: "refused", subjectRef: "x-1", code: "SUBJECT_SCOPE_VIOLATION" }),
    ).toEqual({
      subject_ref: "x-1",
      refusal: "SUBJECT_SCOPE_VIOLATION",
      observations: [],
      conditions: [],
      medications: [],
    });
    expect(codeTable({ kind: "no-subject" }).subject_ref).toBeNull();
  });
});

describe("buildCodeBlock", () => {
  test("the layout and the codes with counts and dates, never a reading", () => {
    const block = buildCodeBlock(codeTable(READ), 6000);
    expect(block.text).toContain("/data/subject.json");
    expect(block.text).toContain(
      `subject_ref=${SUBJECT}: 3 observations (2 codes), 1 conditions, 0 medication requests`,
    );
    expect(block.text).toContain(
      '[1] 4548-4 "Hemoglobin A1c" unit=% n=2 first=2024-02-01 last=2025-06-01',
    );
    expect(block.text).toContain("[2] 29463-7");
    expect(block.text).not.toContain("6.1");
    expect(block.text).not.toContain("81.5");
    expect(block.pasted.map((call) => call.output)).toEqual([
      {
        loinc: "4548-4",
        display: "Hemoglobin A1c",
        unit: "%",
        n: 2,
        first: "2024-02-01",
        last: "2025-06-01",
      },
      {
        loinc: "29463-7",
        display: "Body Weight",
        unit: "kg",
        n: 1,
        first: "2024-01-01",
        last: "2024-01-01",
      },
    ]);
    expect(block.stats).toMatchObject({
      calls: 2,
      rows_total: 4,
      rows_pasted: 0,
      truncated: false,
    });
    expect(block.table).toEqual({
      subject_ref: SUBJECT,
      refusal: null,
      observations: 3,
      conditions: 1,
      medications: 0,
      codes_total: 2,
      codes_listed: 2,
    });
  });

  test("a small cap lists fewer codes and names the rest", () => {
    const full = buildCodeBlock(codeTable(READ), 6000);
    const cut = buildCodeBlock(codeTable(READ), full.stats.tokens - 5);
    expect(cut.table.codes_listed).toBe(1);
    expect(cut.stats.truncated).toBe(true);
    expect(cut.text).toContain("(1 older codes are in the file but not listed: 29463-7)");
  });

  test("refused and unnamed subjects say so", () => {
    expect(
      buildCodeBlock(
        codeTable({
          kind: "refused",
          subjectRef: "x-1",
          code: "SUBJECT_SCOPE_VIOLATION",
        }),
        6000,
      ).text,
    ).toContain("refused: SUBJECT_SCOPE_VIOLATION");
    expect(buildCodeBlock(codeTable({ kind: "no-subject" }), 6000).text).toContain(
      NO_SUBJECT_TABLE_TEXT,
    );
  });
});

describe("codeRunError", () => {
  test("names how a run failed, in order of what decided it", () => {
    expect(codeRunError(ok())).toBeNull();
    expect(codeRunError(ok({ stdout: " \n" }))).toBe("NO_OUTPUT");
    expect(codeRunError(ok({ exitCode: 1 }))).toBe("EXIT_NONZERO");
    expect(codeRunError(ok({ exitCode: null, signal: "SIGKILL" }))).toBe("KILLED");
    expect(
      codeRunError(ok({ exitCode: null, signal: "SIGKILL", outputCapped: true })),
    ).toBe("OUTPUT_CAP");
    expect(codeRunError(ok({ exitCode: null, timedOut: true }))).toBe("TIMEOUT");
    expect(codeRunError(ok({ exitCode: null, signal: "SPAWN_FAILED" }))).toBe(
      "SANDBOX_FAILED",
    );
  });

  test("the model sees output and runs left, not timings", () => {
    const run = codeRunOf("print(1)", ok({ stdoutTruncated: true }));
    expect(runOutput(run, 2)).toEqual({
      ok: true,
      error: null,
      exit_code: 0,
      stdout: "4548-4 mean 6.0 %\n",
      stdout_truncated: true,
      stderr: "",
      runs_left: 2,
    });
  });

  test("retries are the runs after the first", () => {
    const table = buildCodeBlock(codeTable(READ), 6000).table;
    const run = codeRunOf("x", ok());
    expect(codeArmRecord(table, [], 0)).toMatchObject({ retries: 0, limit_hit: false });
    expect(codeArmRecord(table, [run, run, run], 1)).toMatchObject({
      retries: 2,
      limit_hit: true,
    });
  });
});

describe("createRunPythonTool", () => {
  test("runs at most MAX_CODE_RUNS programs, then refuses without running", async () => {
    const ran: string[] = [];
    const { tools, log } = createRunPythonTool(async (code) => {
      ran.push(code);
      return ok({ exitCode: 1, stdout: "", stderr: "Traceback: boom" });
    });
    const execute = tools[RUN_PYTHON_TOOL]?.execute;
    if (execute === undefined) throw new Error("no execute");
    const outputs = [];
    for (let call = 0; call < MAX_CODE_RUNS + 1; call += 1) {
      outputs.push(
        await execute(
          { code: `raise SystemExit(${call})` },
          {
            toolCallId: `c${call}`,
            messages: [],
          },
        ),
      );
    }
    expect(ran.length).toBe(MAX_CODE_RUNS);
    expect(outputs[0]).toMatchObject({ ok: false, error: "EXIT_NONZERO", runs_left: 2 });
    expect(outputs[MAX_CODE_RUNS]).toMatchObject({ code: CODE_RUN_LIMIT });
    expect(log.runs().map((run) => run.code)).toEqual([
      "raise SystemExit(0)",
      "raise SystemExit(1)",
      "raise SystemExit(2)",
    ]);
    expect(log.refusedCalls()).toBe(1);
  });
});
