import { describe, expect, test } from "bun:test";

import type { AnswerOwnership } from "./answer-ownership";
import { createStopChatHandler } from "./stop-chat";

const ANSWER = { turnId: "turn-1", modelId: "synthetic/model" };
const OWNER: AnswerOwnership = {
  kind: "owner",
  appUserId: "user-1",
  modelName: "Synthetic",
  status: "STREAMING",
};

const call = (body: unknown) =>
  new Request("http://localhost/api/chat/stop", {
    method: "POST",
    body: JSON.stringify(body),
  });

const handlerWith = (
  ownership: AnswerOwnership,
  actorId: string | null = "actor-1",
  ended = 1,
) => {
  const stops: unknown[] = [];
  return {
    stops,
    handler: createStopChatHandler({
      resolveActorId: async () => actorId,
      ownership: async () => ownership,
      stop: (answer, mayStillStart) => {
        stops.push([answer, mayStillStart]);
        return ended;
      },
    }),
  };
};

describe("POST /api/chat/stop (#373)", () => {
  test("ends the caller's running answer and says how many", async () => {
    const { handler, stops } = handlerWith(OWNER);
    const response = await handler(call(ANSWER));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ stopped: 1 });
    expect(stops).toEqual([[ANSWER, true]]);
  });

  test("an answer that has ended is not an error, and no stop is held for it", async () => {
    const { handler, stops } = handlerWith(
      { ...OWNER, status: "COMPLETE" },
      "actor-1",
      0,
    );
    const response = await handler(call(ANSWER));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ stopped: 0 });
    expect(stops).toEqual([[ANSWER, false]]);
  });

  test("refuses someone who is not signed in", async () => {
    const { handler, stops } = handlerWith(OWNER, null);
    expect((await handler(call(ANSWER))).status).toBe(401);
    expect(stops).toEqual([]);
  });

  test("refuses another person's answer", async () => {
    const { handler, stops } = handlerWith({ kind: "someone-else" });
    expect((await handler(call(ANSWER))).status).toBe(403);
    expect(stops).toEqual([]);
  });

  test("refuses an answer with no row", async () => {
    const { handler, stops } = handlerWith({ kind: "missing" });
    expect((await handler(call(ANSWER))).status).toBe(400);
    expect(stops).toEqual([]);
  });

  test("refuses a stray field: the body is closed", async () => {
    const { handler, stops } = handlerWith(OWNER);
    expect((await handler(call({ ...ANSWER, text: "x" }))).status).toBe(400);
    expect(stops).toEqual([]);
  });
});
