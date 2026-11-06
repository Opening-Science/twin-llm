import { describe, expect, test } from "bun:test";

import { stopOnServer } from "./stop-answer";

const ANSWER = { turnId: "turn-1", modelId: "synthetic/model" };

describe("stopOnServer (#373)", () => {
  test("posts the turn and model, and survives the page closing", async () => {
    const calls: unknown[] = [];
    await stopOnServer(ANSWER, async (input, init) => {
      calls.push([input, init]);
      return Response.json({ stopped: 1 });
    });
    expect(calls).toEqual([
      [
        "/api/chat/stop",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(ANSWER),
          keepalive: true,
        },
      ],
    ]);
  });

  test("a failed call throws nothing: the column already reads as stopped", async () => {
    const result = await stopOnServer(ANSWER, async () => {
      throw new TypeError("offline");
    });
    expect(result).toBe(undefined);
  });
});
