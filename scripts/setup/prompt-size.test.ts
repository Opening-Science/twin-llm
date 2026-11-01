import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { captureOllamaTurnRequest } from "../../features/chat/ollama-turn-request";
import { applyEffort } from "../../infrastructure/chat-effort";
import {
  DEFAULT_OLLAMA_NUM_CTX,
  promptBudgetTokens,
} from "../../infrastructure/ollama-context";
import {
  LARGE_NUM_CTX,
  loadSkills,
  numCtxFor,
  PROMPT_HEADROOM_TOKENS,
  promptSizeCases,
  sizeProblems,
  sizeRow,
} from "./prompt-size";

/**
 * The context budget (issue #149): the system prompt and model-facing tool
 * list of a first turn, in every data mode and under every skill, must leave
 * TURN_RESERVE_TOKENS free at the context chat asks Ollama for. A longer
 * prompt, a new tool or a bigger schema that breaks this fails here, before
 * Ollama silently cuts the tool definitions off.
 *
 * `bun run prompt:size --ollama qwen3:4b` prints the same cases with
 * Ollama's exact counts next to the estimate used here.
 */

const ROOT = resolve(import.meta.dir, "../..");
const CASES = promptSizeCases(loadSkills(ROOT));

describe("prompt + tools fit the Ollama context", () => {
  test("covers every skill in every data mode", () => {
    expect(CASES.map((sizeCase) => sizeCase.label)).toContain("synthetic /sleep");
    expect(CASES.map((sizeCase) => sizeCase.label)).toContain(
      "personal, no wearable /genome",
    );
    expect(CASES.map((sizeCase) => sizeCase.label)).toContain(
      "personal, Oura agent:trainer",
    );
  });

  test.each(CASES.filter((sizeCase) => !sizeCase.largeContext).map((c) => [c.label, c]))(
    "%s fits the default context with room for the turn",
    async (_label, sizeCase) => {
      const body = await captureOllamaTurnRequest(sizeCase.turn, DEFAULT_OLLAMA_NUM_CTX);
      expect(sizeRow(sizeCase.label, body).estimate).toBeLessThanOrEqual(
        promptBudgetTokens(DEFAULT_OLLAMA_NUM_CTX),
      );
    },
  );

  test.each(CASES.filter((sizeCase) => sizeCase.largeContext).map((c) => [c.label, c]))(
    "%s fits OLLAMA_NUM_CTX=32768",
    async (_label, sizeCase) => {
      const body = await captureOllamaTurnRequest(sizeCase.turn, LARGE_NUM_CTX);
      expect(sizeRow(sizeCase.label, body).estimate).toBeLessThanOrEqual(
        promptBudgetTokens(LARGE_NUM_CTX),
      );
    },
  );

  test.each(CASES.map((c) => [c.label, c]))(
    "%s leaves PROMPT_HEADROOM_TOKENS free before twin notes (#393)",
    async (_label, sizeCase) => {
      const numCtx = numCtxFor(sizeCase, null);
      const body = await captureOllamaTurnRequest(
        { ...sizeCase.turn, twinNotes: [] },
        numCtx,
      );
      expect(sizeRow(sizeCase.label, body).estimate).toBeLessThanOrEqual(
        promptBudgetTokens(numCtx) - PROMPT_HEADROOM_TOKENS,
      );
    },
  );

  test("genome_variants is sent only when a VCF is imported (#399)", async () => {
    const named = async (label: string) => {
      const sizeCase = CASES.find((candidate) => candidate.label === label);
      if (sizeCase === undefined) throw new Error(`no case ${label}`);
      const body = await captureOllamaTurnRequest(sizeCase.turn, DEFAULT_OLLAMA_NUM_CTX);
      return (body.tools ?? []).map((tool) => tool.function.name);
    };
    expect(await named("personal, no wearable")).not.toContain("genome_variants");
    expect(await named("personal, no wearable, VCF imported")).toContain(
      "genome_variants",
    );
    expect(await named("synthetic")).not.toContain("genome_variants");
  });

  test("the request asks Ollama for the context, with thinking off", async () => {
    const [first] = CASES;
    if (first === undefined) throw new Error("no cases");
    const body = await captureOllamaTurnRequest(first.turn, DEFAULT_OLLAMA_NUM_CTX);
    expect(body.options).toEqual({ num_ctx: 16_384 });
    expect(body.think).toBe(false);
    expect(body.messages[0]?.role).toBe("system");
    expect(body.tools?.[0]?.type).toBe("function");
  });

  test("Thorough effort on a thinking model switches thinking on and keeps the context (#366)", async () => {
    const [first] = CASES;
    if (first === undefined) throw new Error("no cases");
    const body = await captureOllamaTurnRequest(
      {
        ...first.turn,
        effort: applyEffort("thorough", { ollama: true, canThink: true }),
      },
      DEFAULT_OLLAMA_NUM_CTX,
    );
    expect(body.options).toEqual({ num_ctx: 16_384 });
    expect(body.think).toBe(true);
  });

  test("effort changes no prompt text or tool, so the budget above holds at every step", async () => {
    const [first] = CASES;
    if (first === undefined) throw new Error("no cases");
    const balanced = await captureOllamaTurnRequest(first.turn, DEFAULT_OLLAMA_NUM_CTX);
    const ultra = await captureOllamaTurnRequest(
      { ...first.turn, effort: applyEffort("ultra", { ollama: true, canThink: true }) },
      DEFAULT_OLLAMA_NUM_CTX,
    );
    expect(ultra.messages).toEqual(balanced.messages);
    expect(ultra.tools).toEqual(balanced.tools);
  });

  test("numCtxFor uses the given context, else the default or 32768 for large cases", () => {
    const small = CASES.find((sizeCase) => !sizeCase.largeContext);
    const large = CASES.find((sizeCase) => sizeCase.largeContext);
    if (small === undefined || large === undefined) throw new Error("no cases");
    expect(numCtxFor(small, null)).toBe(DEFAULT_OLLAMA_NUM_CTX);
    expect(numCtxFor(large, null)).toBe(LARGE_NUM_CTX);
    expect(numCtxFor(large, 8_192)).toBe(8_192);
  });

  test("sizeProblems names an over-budget case and one without headroom", () => {
    expect(sizeProblems({ tokens: 11_000, beforeNotes: 10_000, budget: 12_288 })).toEqual(
      [],
    );
    expect(sizeProblems({ tokens: 12_300, beforeNotes: 11_000, budget: 12_288 })).toEqual(
      ["12 tokens over the budget of 12288"],
    );
    expect(sizeProblems({ tokens: 12_000, beforeNotes: 11_900, budget: 12_288 })).toEqual(
      ["388 tokens free before twin notes, 500 needed"],
    );
  });
});

/**
 * `bun run prompt:size` (#401): it once looked like it stopped after 17
 * cases and still exited 0. It must print a row for every case above, end
 * with a summary and exit 0 only when every case fits.
 */
describe("bun run prompt:size", () => {
  test("prints every case the budget test checks and exits 0", () => {
    const run = Bun.spawnSync([process.execPath, "run", "prompt:size"], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const rows = run.stdout
      .toString()
      .split("\n")
      .map((line) => line.split(" | "))
      .filter((cells) => cells.length > 2);
    const labels = rows.map(([label]) => label).filter((label) => label !== "case");
    expect(labels).toEqual(CASES.map((sizeCase) => sizeCase.label));
    expect(rows.every((cells) => cells.at(-1) === "yes" || cells[0] === "case")).toBe(
      true,
    );
    expect(run.stdout.toString()).toContain(`${CASES.length} cases, all fit.`);
    expect(run.exitCode).toBe(0);
  });
});
