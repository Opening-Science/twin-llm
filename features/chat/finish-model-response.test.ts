import { describe, expect, test } from "bun:test";

import { parseTwinAnswer } from "@/infrastructure/parse-twin-answer";
import type { ResponseDocumentV1 } from "@/infrastructure/response-document/document-v1";

import { finishModelResponse } from "./finish-model-response";
import { buildResponseDocumentV1 } from "./response/build-document";

const document = buildResponseDocumentV1({
  parsed: parseTwinAnswer(
    "## Evidence Used\n- none\n\n## Answer\nSynthetic.\n\n## Uncertainty\nSynthetic.",
    null,
  ),
  toolCalls: [],
  mode: "personal",
});

class WriteError extends Error {
  override name = "WriteError";
}

const recorder = (options: {
  readonly build?: () => Promise<ResponseDocumentV1>;
  readonly completeFails?: boolean;
  readonly failedFails?: boolean;
}) => {
  const calls: string[] = [];
  const completed: (ResponseDocumentV1 | null)[] = [];
  const logs: (readonly [string, string])[] = [];
  return {
    calls,
    completed,
    logs,
    ports: {
      buildDocument: options.build ?? (async () => document),
      writeComplete: async (built: ResponseDocumentV1 | null) => {
        calls.push("complete");
        completed.push(built);
        if (options.completeFails) throw new WriteError("row value echoed here");
      },
      writeFailed: async () => {
        calls.push("failed");
        if (options.failedFails) throw new WriteError("row value echoed here");
      },
      logError: (message: string, errorName: string) => {
        logs.push([message, errorName]);
      },
    },
  };
};

describe("finishModelResponse", () => {
  test("a successful write completes with the document", async () => {
    const run = recorder({});
    expect(await finishModelResponse(run.ports)).toEqual({
      document,
      status: "COMPLETE",
    });
    expect(run.calls).toEqual(["complete"]);
    expect(run.completed).toEqual([document]);
    expect(run.logs).toEqual([]);
  });

  test("a failed complete write marks the row failed, keeps the document, logs names only", async () => {
    const run = recorder({ completeFails: true });
    expect(await finishModelResponse(run.ports)).toEqual({ document, status: "FAILED" });
    expect(run.calls).toEqual(["complete", "failed"]);
    expect(run.logs).toEqual([["could not store the answer", "WriteError"]]);
  });

  test("a failed build still stores the text without a document", async () => {
    const run = recorder({
      build: async () => {
        throw new WriteError("audit read failed");
      },
    });
    expect(await finishModelResponse(run.ports)).toEqual({
      document: null,
      status: "COMPLETE",
    });
    expect(run.completed).toEqual([null]);
    expect(run.logs).toEqual([["could not build the response document", "WriteError"]]);
  });

  test("if marking failed also fails, it is logged and the outcome is still FAILED", async () => {
    const run = recorder({ completeFails: true, failedFails: true });
    expect(await finishModelResponse(run.ports)).toEqual({ document, status: "FAILED" });
    expect(run.logs).toEqual([
      ["could not store the answer", "WriteError"],
      ["could not record the answer as failed", "WriteError"],
    ]);
  });
});
