import { describe, expect, test } from "bun:test";

import { MockLanguageModelV4 } from "ai/test";

import { CHAT_STOP_AUDIT_TOOL } from "@/infrastructure/chat-stop";
import type { AppendInput } from "@/packages/audit/append";

import {
  createStreamModelResponse,
  type StreamContext,
} from "./create-stream-model-response";
import { createRunningAnswers } from "./running-answers";
import type { ModelResponseStoppedParams } from "./write-model-response-complete";

/**
 * Stop on the server (#373), from the signal to the row and the audit chain.
 * Fake model and fake ports; synthetic ids. The fake model writes a little and
 * then waits on its signal, as a request to a local model does.
 */

const TURN = "turn-synthetic-1";
const MODEL = "synthetic/model";
const ANSWER = { turnId: TURN, modelId: MODEL };

const writesThenWaits = (order: string[]) =>
  new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => ({
      stream: new ReadableStream<never>({
        start: (controller) => {
          const enqueue = (part: unknown) => controller.enqueue(part as never);
          enqueue({ type: "text-start", id: "t" });
          enqueue({ type: "text-delta", id: "t", delta: "Written so far" });
          abortSignal?.addEventListener("abort", () => {
            order.push("model call ended");
            controller.error(abortSignal.reason);
          });
        },
      }),
    }),
  });

const CONTEXT: StreamContext = {
  clerkId: "user_synthetic_1",
  genomeThread: false,
  ouraSummary: null,
  whoopSummary: null,
  googleHealthSummary: null,
  vitronicSummary: null,
};

const setUp = (
  store: Readonly<{
    writeStopped?: (params: ModelResponseStoppedParams) => Promise<unknown>;
    appendAudit?: (input: AppendInput) => Promise<unknown>;
  }> = {},
) => {
  const stopped: ModelResponseStoppedParams[] = [];
  const audited: AppendInput[] = [];
  const log: string[] = [];
  const order: string[] = [];
  const respond = createStreamModelResponse({
    settings: () => ({ dataMode: "synthetic", provider: "ollama" }),
    chatIsLocal: () => true,
    resolveModel: () => writesThenWaits(order),
    genomeTools: () => undefined,
    variantTools: async () => undefined,
    importedTools: () => undefined,
    loadAudit: async () => [],
    store: {
      writeComplete: async () => {
        log.push("complete");
      },
      writeStopped:
        store.writeStopped ??
        (async (params) => {
          order.push("row stored");
          stopped.push(params);
        }),
      writeFailed: async () => {
        log.push("failed");
      },
      markRefused: async () => {
        log.push("refused");
      },
      loadViews: async () => [],
    },
    appendAudit:
      store.appendAudit ??
      (async (input) => {
        order.push("audited");
        audited.push(input);
      }),
    analytics: { answered: () => undefined, generation: async () => undefined },
  });
  return { respond, stopped, audited, log, order };
};

const request = {
  ...ANSWER,
  messages: [{ role: "user" as const, content: "How is my heart rate?" }],
};

/** Runs one answer, presses Stop once it has written, and reads the stream out. */
const stopOne = async (setup: ReturnType<typeof setUp>) => {
  const answers = createRunningAnswers();
  const response = await setup.respond(request, {
    ...CONTEXT,
    stop: answers.start(ANSWER),
  });
  const pressed = setTimeout(() => answers.stop(ANSWER, true), 20);
  await response.text();
  clearTimeout(pressed);
  setup.order.push("stream ended");
  return { answers };
};

describe("Stop on the server (#373)", () => {
  test("the model call ends, the row is STOPPED with the text, and the stop is audited", async () => {
    const setup = setUp();
    await stopOne(setup);
    expect(setup.order).toEqual([
      "model call ended",
      "row stored",
      "audited",
      "stream ended",
    ]);
    expect(
      setup.stopped.map(({ turnId, modelId, text }) => [turnId, modelId, text]),
    ).toEqual([[TURN, MODEL, "Written so far"]]);
    expect(setup.log).toEqual([]);
    expect(setup.audited).toEqual([
      {
        actor: "user_synthetic_1",
        sessionId: TURN,
        subjectRef: null,
        tool: CHAT_STOP_AUDIT_TOOL,
        args: { modelId: MODEL },
        result: {},
        rowCount: 0,
      },
    ]);
  });

  test("the answer leaves the list when its stream has ended", async () => {
    const { answers } = await stopOne(setUp());
    expect(answers.stop(ANSWER, false)).toBe(0);
  });

  test("a row that cannot be written is marked failed, not left STREAMING", async () => {
    const setup = setUp({
      writeStopped: async () => {
        throw new Error("no database");
      },
    });
    await stopOne(setup);
    expect(setup.log).toEqual(["failed"]);
    expect(setup.audited.map((row) => row.tool)).toEqual([CHAT_STOP_AUDIT_TOOL]);
  });

  test("a failed audit write leaves the row stored and still ends the stream", async () => {
    const setup = setUp({
      appendAudit: async () => {
        throw new Error("no chain");
      },
    });
    await stopOne(setup);
    expect(setup.stopped.map((row) => row.text)).toEqual(["Written so far"]);
  });

  test("a Stop that came first ends the answer as it starts", async () => {
    const setup = setUp();
    const answers = createRunningAnswers();
    answers.stop(ANSWER, true);
    const response = await setup.respond(request, {
      ...CONTEXT,
      stop: answers.start(ANSWER),
    });
    await response.text();
    expect(setup.stopped.map((row) => row.text)).toEqual([""]);
    expect(setup.audited.length).toBe(1);
  });
});
