import { describe, expect, test } from "bun:test";

import { toResponseDocument } from "@/infrastructure/response-document/parse";
import { sha256Hex, toCanonicalJson } from "@/packages/audit/hash";

import {
  type ModelResponseCompleteUpdate,
  type ModelResponseFailedUpdate,
  type ModelResponseRefusedUpdate,
  writeModelResponseComplete,
  writeModelResponseFailed,
  writeModelResponseRefused,
} from "./write-model-response-complete";

const metrics = {
  modelId: "synthetic/model",
  timeToFirstTokenMs: 120,
  tokensPerSecond: 42.5,
  inputTokens: 10,
  outputTokens: 20,
  totalTokens: 30,
  costUsd: 0,
} as const;

const document = toResponseDocument({
  schema_version: "twin-llm.response.v1",
  intended_use: "research_hypothesis_generation_n_of_1",
  not_for_diagnostic_use: true,
  sufficient_data: false,
  abstained: false,
  data_basis: {
    evidence_keys: [],
    hallucinated_keys: [],
    tool_calls: [],
    sources: { gbd: [], guidelines: [] },
    gbd_rows: [],
  },
  uncertainty: { model_statement: "Synthetic." },
  next_step: "more_data",
  interpretation: { kind: "none" },
});

const completedAt = new Date("2026-10-15T09:00:00.000Z");

const capture = () => {
  const calls: ModelResponseCompleteUpdate[] = [];
  return {
    calls,
    port: {
      update: async (args: ModelResponseCompleteUpdate) => {
        calls.push(args);
        return null;
      },
    },
  };
};

describe("writeModelResponseComplete", () => {
  test("stores the response document with the completed row", async () => {
    expect(document).not.toBeNull();
    const { calls, port } = capture();
    await writeModelResponseComplete(
      port,
      {
        turnId: "turn-1",
        modelId: "synthetic/model",
        text: "Synthetic text.",
        metrics,
        reasoningText: "Synthetic reasoning.",
        attribution: [],
        document,
      },
      () => completedAt,
    );
    expect(calls).toEqual([
      {
        where: { turnId_modelId: { turnId: "turn-1", modelId: "synthetic/model" } },
        data: {
          text: "Synthetic text.",
          status: "COMPLETE",
          timeToFirstTokenMs: 120,
          tokensPerSecond: 42.5,
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
          reasoningText: "Synthetic reasoning.",
          attribution: [],
          responseDocument: document!,
          completedAt,
        },
      },
    ]);
  });

  test("stores each tool result with the hashes of its audit row", async () => {
    const input = { subject_ref: "synthetic-subject-1", loinc: "8867-4" };
    const output = { rows: [{ value: 62, unit_ucum: "/min" }] };
    const argsSha256 = sha256Hex(toCanonicalJson(input));
    const resultSha256 = sha256Hex(toCanonicalJson(output));
    const audited = toResponseDocument({
      ...document!,
      data_basis: {
        ...document!.data_basis,
        tool_calls: [
          {
            seq: 7,
            tool: "query_observations",
            args_sha256: argsSha256,
            result_sha256: resultSha256,
            row_count: 1,
            ts: "2026-10-15T08:59:58.000Z",
          },
        ],
      },
    });
    const { calls, port } = capture();
    await writeModelResponseComplete(
      port,
      {
        turnId: "turn-4",
        modelId: "synthetic/model",
        text: "Synthetic text.",
        metrics,
        document: audited,
        toolResults: [{ toolName: "query_observations", input, output }],
      },
      () => completedAt,
    );
    expect(calls[0]!.data.toolParts).toEqual([
      {
        seq: 1,
        tool: "query_observations",
        input,
        output,
        argsSha256,
        resultSha256,
        rowCount: 1,
        at: "2026-10-15T09:00:00.000Z",
      },
    ]);
  });

  test("an answer that used no tool stores null tool parts", async () => {
    const { calls, port } = capture();
    await writeModelResponseComplete(
      port,
      {
        turnId: "turn-5",
        modelId: "synthetic/model",
        text: "Synthetic text.",
        metrics,
        document,
        toolResults: [],
      },
      () => completedAt,
    );
    expect(calls[0]!.data.toolParts).toBeNull();
  });

  test("leaves the column untouched when there is no document", async () => {
    const { calls, port } = capture();
    await writeModelResponseComplete(
      port,
      { turnId: "turn-2", modelId: "synthetic/model", text: "", metrics, document: null },
      () => completedAt,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.data.responseDocument).toBeUndefined();
    expect(calls[0]!.data.reasoningText).toBeNull();
    expect(calls[0]!.data.attribution).toBeUndefined();
  });
});

describe("writeModelResponseFailed", () => {
  test("marks the row failed with a completion time", async () => {
    const calls: ModelResponseFailedUpdate[] = [];
    await writeModelResponseFailed(
      { update: async (args: ModelResponseFailedUpdate) => calls.push(args) },
      { turnId: "turn-3", modelId: "synthetic/model" },
      () => completedAt,
    );
    expect(calls).toEqual([
      {
        where: { turnId_modelId: { turnId: "turn-3", modelId: "synthetic/model" } },
        data: { status: "FAILED", completedAt },
      },
    ]);
  });
});

describe("writeModelResponseRefused", () => {
  test("marks the row refused with the refusal sentence and a completion time", async () => {
    const calls: ModelResponseRefusedUpdate[] = [];
    await writeModelResponseRefused(
      { update: async (args: ModelResponseRefusedUpdate) => calls.push(args) },
      {
        turnId: "turn-4",
        modelId: "synthetic/model",
        sentence: "/sleep runs only on local Ollama.",
      },
      () => completedAt,
    );
    expect(calls).toEqual([
      {
        where: { turnId_modelId: { turnId: "turn-4", modelId: "synthetic/model" } },
        data: {
          status: "REFUSED",
          text: "/sleep runs only on local Ollama.",
          completedAt,
        },
      },
    ]);
  });
});
