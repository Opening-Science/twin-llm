import { describe, expect, test } from "bun:test";

import type { ChatRequest } from "@/features/chat/chat-request";
import { NO_WEARABLES } from "@/features/chat/wearable-context";
import type { AppendInput } from "@/packages/audit/append";

import { answerMayStart, type AnswerStartDeps, createAnswerStart } from "./answer-start";

const CALL: ChatRequest = {
  modelId: "qwen3:4b",
  turnId: "turn-synthetic-1",
  messages: [
    { role: "user", content: "How did heart rate change for the synthetic subject?" },
  ],
};

type Fake = AnswerStartDeps & { marks: string[]; logs: string[] };

const deps = (overrides: Partial<AnswerStartDeps> = {}): Fake => {
  const marks: string[] = [];
  const logs: string[] = [];
  return {
    marks,
    logs,
    settings: () => ({
      dataMode: "synthetic",
      provider: "ollama",
      exoscalePersonalData: "off",
    }),
    chatIsLocal: () => true,
    loadGenomeThread: async () => ({ threadId: "thread-synthetic-1", usedGenome: false }),
    loadWearables: async () => NO_WEARABLES,
    loadDisabledSources: async () => [],
    appendAudit: async () => undefined,
    findSkill: async () => null,
    stream: async () => new Response("streamed"),
    markRefused: async ({ sentence }) => {
      marks.push(`refused: ${sentence}`);
    },
    markFailed: async () => {
      marks.push("failed");
    },
    logError: (message) => {
      logs.push(message);
    },
    ...overrides,
  };
};

describe("starting one answer (SERVER-SPEC 3.4)", () => {
  test("a clean start streams and marks nothing", async () => {
    const fake = deps();
    const response = await createAnswerStart(fake)("actor-1", "user-1", CALL);
    expect(await response.text()).toBe("streamed");
    expect(fake.marks).toEqual([]);
  });

  test("a failed audit write before the model call ends the row as failed", async () => {
    let streamed = false;
    const fake = deps({
      appendAudit: async (input: AppendInput) => {
        if (input.tool === "chat.effort") throw new Error("database down");
      },
      stream: async () => {
        streamed = true;
        return new Response("streamed");
      },
    });
    await expect(createAnswerStart(fake)("actor-1", "user-1", CALL)).rejects.toThrow(
      "database down",
    );
    expect(streamed).toBe(false);
    expect(fake.marks).toEqual(["failed"]);
  });

  test("a failed mark is logged by name and the first error still surfaces", async () => {
    const fake = deps({
      stream: async () => {
        throw new TypeError("setup");
      },
      markFailed: async () => {
        throw new Error("row gone");
      },
    });
    await expect(createAnswerStart(fake)("actor-1", "user-1", CALL)).rejects.toThrow(
      "setup",
    );
    expect(fake.logs).toEqual(["could not mark the answer failed"]);
  });

  test("a refusal is stored, and still goes out when storing it fails", async () => {
    const stored = deps();
    const refused = await createAnswerStart(stored)("actor-1", "user-1", {
      ...CALL,
      skill: "nosuchskill",
    });
    expect(refused.status).toBe(400);
    expect(stored.marks.length).toBe(1);
    expect(stored.marks[0]?.startsWith("refused: ")).toBe(true);

    const lost = deps({
      markRefused: async () => {
        throw new Error("row gone");
      },
    });
    const stillRefused = await createAnswerStart(lost)("actor-1", "user-1", {
      ...CALL,
      skill: "nosuchskill",
    });
    expect(stillRefused.status).toBe(400);
    expect(lost.logs).toEqual(["could not store the refusal"]);
    expect(lost.marks).toEqual([]);
  });
});

describe("which rows may be asked for (SERVER-SPEC 3.4, decided)", () => {
  test("a finished answer is refused; failed, refused, stopped and streaming may run", () => {
    expect(answerMayStart("COMPLETE")).toBe(false);
    for (const status of ["STREAMING", "FAILED", "REFUSED", "STOPPED"] as const) {
      expect(answerMayStart(status)).toBe(true);
    }
  });
});
