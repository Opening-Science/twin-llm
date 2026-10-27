import { describe, expect, test } from "bun:test";

import { guardGenomeHistory } from "./genome-history-guard";

const REQUEST = {
  turnId: "turn-synthetic-1",
  modelId: "synthetic/model",
  messages: [{ role: "user" as const, content: "How did I sleep?" }],
};

const SENTENCE = "This thread used your genome report, so it only runs on local models.";

/** A fake model next to the guard: it records a call only if the guard lets one through. */
const run = async (
  chatIsLocal: boolean,
  genomeThread: boolean,
  messages: (typeof REQUEST)["messages"] = REQUEST.messages,
) => {
  const refused: string[] = [];
  const modelCalls: string[] = [];
  const held = await guardGenomeHistory(
    {
      chatIsLocal: () => chatIsLocal,
      markRefused: async (target) => {
        refused.push(`${target.turnId} ${target.modelId} ${target.sentence}`);
      },
    },
    { ...REQUEST, messages },
    genomeThread,
  );
  if (held === null) modelCalls.push("model");
  return { held, refused, modelCalls };
};

describe("guardGenomeHistory", () => {
  test("a genome thread reaching a hosted model is held: stored REFUSED, no call", async () => {
    const { held, refused, modelCalls } = await run(false, true);
    expect(held?.status).toBe(400);
    expect(await held?.json()).toEqual({
      code: "GENOME_THREAD_LOCAL_ONLY",
      error: SENTENCE,
    });
    expect(refused).toEqual([`turn-synthetic-1 synthetic/model ${SENTENCE}`]);
    expect(modelCalls).toEqual([]);
  });

  test("a genome part that slipped into the history is held too", async () => {
    const { refused, modelCalls } = await run(false, false, [
      { role: "user", content: "/genome" },
      { role: "user", content: "and now?" },
    ]);
    expect(refused).toEqual([`turn-synthetic-1 synthetic/model ${SENTENCE}`]);
    expect(modelCalls).toEqual([]);
  });

  test("a local model gets a genome thread", async () => {
    const { held, refused, modelCalls } = await run(true, true);
    expect(held).toBeNull();
    expect(refused).toEqual([]);
    expect(modelCalls).toEqual(["model"]);
  });

  test("a plain thread goes to a hosted model", async () => {
    const { held, modelCalls } = await run(false, false);
    expect(held).toBeNull();
    expect(modelCalls).toEqual(["model"]);
  });
});
