import { describe, expect, test } from "bun:test";

import {
  inPickOrder,
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
          position: 1,
          status: "COMPLETE",
          text: "## Answer\nHRV rose from 41 ms to 48 ms.",
          reasoningText: "Synthetic reasoning citing oura.hrv 48 ms.",
          attribution: [{ metricKey: "oura.hrv", label: "HRV", value: 48, unit: "ms" }],
          responseDocument: null,
          toolParts: null,
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
          position: 0,
          status: "COMPLETE",
          text: "## Answer\nWithheld synthetic text quoting 48 ms.",
          reasoningText: "Withheld synthetic reasoning.",
          attribution: null,
          responseDocument: makeResponseDocument({ abstained: true }),
          toolParts: null,
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

/** A saved answer row with nothing but its id, model and position. */
const savedRow = (
  id: string,
  modelId: string,
  position: number | null,
): StoredThread["turns"][number]["responses"][number] => ({
  id,
  modelId,
  modelName: modelId,
  position,
  status: "COMPLETE",
  text: `## Answer\nSynthetic answer from ${modelId}.`,
  reasoningText: null,
  attribution: null,
  responseDocument: null,
  timeToFirstTokenMs: null,
  tokensPerSecond: null,
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  costUsd: 0,
});

const reads = (
  actorId: string | null,
  userIds: Record<string, string>,
  skills: ReadonlyMap<string, string> = new Map(),
  thread: StoredThread = stored,
): ThreadReads => ({
  actorId: async () => actorId,
  appUserIdFor: async (actor) => userIds[actor] ?? null,
  findThread: async (id) => (id === thread.id ? thread : null),
  skillsOfTurns: async (turnIds) =>
    new Map([...skills].filter(([turnId]) => turnIds.includes(turnId))),
});

describe("loadOwnedThread", () => {
  test("the owner gets the thread", async () => {
    const thread = await loadOwnedThread(
      "thread-1",
      reads("clerk-owner", { "clerk-owner": "user-owner" }),
    );
    expect(thread?.title).toBe("Synthetic: HRV trend");
    expect(thread?.turns[0]?.answers[1]?.text).toBe(
      "## Answer\nHRV rose from 41 ms to 48 ms.",
    );
    expect(thread?.turns[0]?.answers[1]?.attribution).toEqual([
      { metricKey: "oura.hrv", label: "HRV", value: 48, unit: "ms" },
    ]);
  });

  test("answers come back in the order the models were picked", async () => {
    const thread = await loadOwnedThread(
      "thread-1",
      reads("clerk-owner", { "clerk-owner": "user-owner" }),
    );
    expect(thread?.turns[0]?.answers.map(({ id }) => id)).toEqual(["r-2", "r-1"]);
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
    const withheld = thread?.turns[0]?.answers[0];
    expect(withheld?.document?.abstained).toBe(true);
    expect(withheld?.text).toBe("");
    expect(withheld?.reasoningText).toBeNull();
    expect(JSON.stringify(thread)).not.toContain("Withheld synthetic");
  });
});

describe("a turn sent with a skill, after a reload", () => {
  const owner = { "clerk-owner": "user-owner" };

  test("an ordinary turn has no skill", async () => {
    const thread = await loadOwnedThread("thread-1", reads("clerk-owner", owner));
    expect(thread?.turns[0]?.skill).toBeNull();
  });

  test("a turn a scheduled task asked comes back marked, a typed one does not", async () => {
    const typed = await loadOwnedThread("thread-1", reads("clerk-owner", owner));
    expect(typed?.turns[0]?.scheduled).toBeUndefined();
    const scheduledThread: StoredThread = {
      ...stored,
      turns: stored.turns.map((turn) => ({ ...turn, scheduled: true })),
    };
    const scheduled = await loadOwnedThread(
      "thread-1",
      reads("clerk-owner", owner, new Map([["turn-1", "sleep"]]), scheduledThread),
    );
    expect(scheduled?.turns[0]?.scheduled).toBe(true);
    expect(scheduled?.turns[0]?.skill).toBe("sleep");
  });

  test("the skill comes back from the turn's skill audit row", async () => {
    const thread = await loadOwnedThread(
      "thread-1",
      reads("clerk-owner", owner, new Map([["turn-1", "sleep"]])),
    );
    expect(thread?.turns[0]?.skill).toBe("sleep");
  });

  test("without an audit row it comes back from a stored response document", async () => {
    const [turn] = stored.turns;
    const withSkillDocument: StoredThread = {
      ...stored,
      turns: [
        {
          ...turn!,
          responses: [
            savedRow("r-x", "qwen3:4b", 0),
            {
              ...savedRow("r-y", "medgemma:4b", 1),
              responseDocument: { ...makeResponseDocument(), skill: "sleep" },
            },
          ],
        },
      ],
    };
    const thread = await loadOwnedThread(
      "thread-1",
      reads("clerk-owner", owner, new Map(), withSkillDocument),
    );
    expect(thread?.turns[0]?.skill).toBe("sleep");
  });
});

describe("requireOwnedThread", () => {
  const owner = reads("clerk-owner", { "clerk-owner": "user-owner" });
  /** What Next's `notFound()` throws; thrown from the layout it sets the 404 status. */
  const notFoundSignal = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };

  test("the owner gets the thread", async () => {
    const thread = await requireOwnedThread("thread-1", owner);
    expect(thread.id).toBe("thread-1");
    expect(thread.turns[0]?.answers[0]?.modelId).toBe("medgemma:4b");
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

describe("inPickOrder", () => {
  test("positions 2, 0, 1 load as 0, 1, 2", () => {
    const rows = [
      savedRow("r-c", "model-c", 2),
      savedRow("r-a", "model-a", 0),
      savedRow("r-b", "model-b", 1),
    ];
    expect(inPickOrder(rows).map(({ id, position }) => [id, position])).toEqual([
      ["r-a", 0],
      ["r-b", 1],
      ["r-c", 2],
    ]);
  });

  test("rows without a position keep their creation order", () => {
    const rows = [
      savedRow("r-c", "model-c", null),
      savedRow("r-a", "model-a", null),
      savedRow("r-b", "model-b", null),
    ];
    expect(inPickOrder(rows).map(({ id }) => id)).toEqual(["r-c", "r-a", "r-b"]);
  });
});
