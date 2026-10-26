import { describe, expect, test } from "bun:test";

import {
  loadOwnedThread,
  requireOwnedThread,
  type StoredThread,
  type ThreadReads,
} from "./owned-thread";
import { makeResponseDocument } from "./response-document-fixture";

/** Synthetic thread: a question about a synthetic subject's HRV, answered once and withheld once. */
const stored: StoredThread = {
  id: "thread-1",
  userId: "user-owner",
  title: "Synthetic: HRV trend",
  turns: [
    {
      id: "turn-1",
      prompt: "Synthetic: how did HRV change this week?",
      responses: [
        {
          id: "r-1",
          modelId: "qwen3:8b",
          modelName: "qwen3:8b",
          status: "COMPLETE",
          text: "## Answer\nHRV rose from 41 ms to 48 ms.",
          reasoningText: "Synthetic reasoning citing oura.hrv 48 ms.",
          attribution: [{ metricKey: "oura.hrv", label: "HRV", value: 48, unit: "ms" }],
          responseDocument: null,
          timeToFirstTokenMs: 900,
          tokensPerSecond: 12.5,
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          costUsd: 0,
        },
        {
          id: "r-2",
          modelId: "medgemma:4b",
          modelName: "medgemma:4b",
          status: "COMPLETE",
          text: "## Answer\nWithheld synthetic text quoting 48 ms.",
          reasoningText: "Withheld synthetic reasoning.",
          attribution: null,
          responseDocument: makeResponseDocument({ abstained: true }),
          timeToFirstTokenMs: null,
          tokensPerSecond: null,
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          costUsd: 0,
        },
      ],
    },
  ],
};

const reads = (actorId: string | null, userIds: Record<string, string>): ThreadReads => ({
  actorId: async () => actorId,
  appUserIdFor: async (actor) => userIds[actor] ?? null,
  findThread: async (id) => (id === stored.id ? stored : null),
});

describe("loadOwnedThread", () => {
  test("the owner gets the thread", async () => {
    const thread = await loadOwnedThread(
      "thread-1",
      reads("clerk-owner", { "clerk-owner": "user-owner" }),
    );
    expect(thread?.title).toBe("Synthetic: HRV trend");
    expect(thread?.turns[0]?.answers[0]?.text).toBe(
      "## Answer\nHRV rose from 41 ms to 48 ms.",
    );
    expect(thread?.turns[0]?.answers[0]?.attribution).toEqual([
      { metricKey: "oura.hrv", label: "HRV", value: 48, unit: "ms" },
    ]);
  });

  test("anyone else holding the link gets nothing, exactly like an unknown id", async () => {
    const other = reads("clerk-other", {
      "clerk-owner": "user-owner",
      "clerk-other": "user-other",
    });
    expect(await loadOwnedThread("thread-1", other)).toBeNull();
    expect(await loadOwnedThread("thread-1", reads(null, {}))).toBeNull();
    expect(await loadOwnedThread("thread-1", reads("clerk-new", {}))).toBeNull();
    expect(
      await loadOwnedThread(
        "no-such-thread",
        reads("clerk-owner", { "clerk-owner": "user-owner" }),
      ),
    ).toBeNull();
  });

  test("a withheld answer's text and reasoning never leave the server", async () => {
    const thread = await loadOwnedThread(
      "thread-1",
      reads("clerk-owner", { "clerk-owner": "user-owner" }),
    );
    const withheld = thread?.turns[0]?.answers[1];
    expect(withheld?.document?.abstained).toBe(true);
    expect(withheld?.text).toBe("");
    expect(withheld?.reasoningText).toBeNull();
    expect(JSON.stringify(thread)).not.toContain("Withheld synthetic");
  });
});

describe("requireOwnedThread", () => {
  const owner = reads("clerk-owner", { "clerk-owner": "user-owner" });
  /** What Next's `notFound()` throws; thrown from the layout it sets the 404 status. */
  const notFoundSignal = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };

  test("the owner gets the thread", async () => {
    const thread = await requireOwnedThread("thread-1", owner);
    expect(thread.id).toBe("thread-1");
    expect(thread.turns[0]?.answers[0]?.modelId).toBe("qwen3:8b");
  });

  test("anyone else, and an unknown id, gets Next's 404 signal", async () => {
    const other = reads("clerk-other", {
      "clerk-owner": "user-owner",
      "clerk-other": "user-other",
    });
    await expect(requireOwnedThread("thread-1", other)).rejects.toMatchObject(
      notFoundSignal,
    );
    await expect(requireOwnedThread("thread-1", reads(null, {}))).rejects.toMatchObject(
      notFoundSignal,
    );
    await expect(requireOwnedThread("no-such-thread", owner)).rejects.toMatchObject(
      notFoundSignal,
    );
  });
});
