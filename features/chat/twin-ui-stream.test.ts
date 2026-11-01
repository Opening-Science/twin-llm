import { describe, expect, test } from "bun:test";

import type { InferUIMessageChunk } from "ai";

import { timeseriesView } from "@/infrastructure/chat-view";
import type { ChatUIMessage } from "@/infrastructure/model-response-metrics";

import { twinUIMessageResponse, withViewParts } from "./twin-ui-stream";

type Chunk = InferUIMessageChunk<ChatUIMessage>;

const view = timeseriesView({
  spec: {
    measure: "sleep.score",
    label: "Sleep score",
    unit: null,
    window: { start: "2026-10-01", end: "2026-10-31" },
    subject: null,
    points: [{ at: "2026-10-01T00:00:00.000Z", value: 77 }],
  },
  sourceAuditIds: ["7"],
});

const run = async (chunks: readonly Chunk[]): Promise<Chunk[]> => {
  const stream = new ReadableStream<Chunk>({
    start: (controller) => {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
  }).pipeThrough(withViewParts());
  return Array.fromAsync(stream);
};

describe("withViewParts", () => {
  test("a show_view output is followed by a data-view part carrying the view", async () => {
    const chunks: Chunk[] = [
      {
        type: "tool-input-available",
        toolCallId: "c1",
        toolName: "show_view",
        input: {},
      },
      { type: "tool-output-available", toolCallId: "c1", output: view },
    ];
    expect(await run(chunks)).toEqual([
      ...chunks,
      { type: "data-view", id: "view-7", data: view },
    ]);
  });

  test("a reopened view streams as a data-view part the same way", async () => {
    const chunks: Chunk[] = [
      { type: "tool-input-start", toolCallId: "c3", toolName: "open_view" },
      { type: "tool-output-available", toolCallId: "c3", output: view },
    ];
    expect(await run(chunks)).toEqual([
      ...chunks,
      { type: "data-view", id: "view-7", data: view },
    ]);
  });

  test("other tools and show_view refusals add nothing", async () => {
    const chunks: Chunk[] = [
      { type: "tool-input-available", toolCallId: "c1", toolName: "trend", input: {} },
      { type: "tool-output-available", toolCallId: "c1", output: view },
      { type: "tool-input-start", toolCallId: "c2", toolName: "show_view" },
      {
        type: "tool-output-available",
        toolCallId: "c2",
        output: { code: "SUBJECT_REQUIRED", error: "x" },
      },
    ];
    expect(await run(chunks)).toEqual(chunks);
  });
});

describe("twinUIMessageResponse and the number check (#366)", () => {
  const empty = () =>
    new ReadableStream<Chunk>({
      start: (controller) => controller.close(),
    });

  const partsOf = async (reviewing?: Promise<boolean>): Promise<string> =>
    twinUIMessageResponse({
      modelStream: empty(),
      finished: Promise.resolve(null),
      ...(reviewing === undefined ? {} : { reviewing }),
      onError: () => "failed",
    }).text();

  test("a started check is announced before the stream ends", async () => {
    const body = await partsOf(Promise.resolve(true));
    expect(body).toContain('{"type":"data-number-review","data":{"state":"running"}}');
    expect(body.indexOf("data-number-review")).toBeLessThan(body.indexOf('"finish"'));
  });

  test("no check, no part", async () => {
    expect(await partsOf(Promise.resolve(false))).not.toContain("data-number-review");
    expect(await partsOf()).not.toContain("data-number-review");
  });
});
