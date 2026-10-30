import { describe, expect, test } from "bun:test";

import type { AppendInput } from "@/packages/audit/append";

import {
  createThreadDeleteHandler,
  THREAD_DELETE_AUDIT_TOOL,
} from "./thread-delete-handler";

const setup = (
  overrides: Partial<{
    actor: string | null;
    userId: string | null;
    owned: ReadonlyMap<string, number>;
  }> = {},
) => {
  const audits: AppendInput[] = [];
  const deleted: string[] = [];
  const owned = overrides.owned ?? new Map([["t1", 3]]);
  const handler = createThreadDeleteHandler({
    actorId: () =>
      Promise.resolve(overrides.actor === undefined ? "actor-1" : overrides.actor),
    appUserIdFor: () =>
      Promise.resolve(overrides.userId === undefined ? "user-1" : overrides.userId),
    deleteOwnedThread: (userId, threadId) => {
      const turns = userId === "user-1" ? owned.get(threadId) : undefined;
      if (turns === undefined) return Promise.resolve(null);
      deleted.push(threadId);
      return Promise.resolve(turns);
    },
    appendAudit: (input) => {
      audits.push(input);
      return Promise.resolve();
    },
  });
  return { handler, audits, deleted };
};

describe("createThreadDeleteHandler", () => {
  test("deletes the owner's thread and writes one audit row with the turn count", async () => {
    const { handler, audits, deleted } = setup();
    const response = await handler("t1");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, turnsDeleted: 3 });
    expect(deleted).toEqual(["t1"]);
    expect(audits).toEqual([
      {
        actor: "actor-1",
        sessionId: "t1",
        subjectRef: null,
        tool: THREAD_DELETE_AUDIT_TOOL,
        args: { thread_id: "t1" },
        result: { turns_deleted: 3 },
        rowCount: 3,
      },
    ]);
  });

  test("someone else's thread, a made-up id and a signed-out caller all get 404 and no audit", async () => {
    for (const run of [
      setup().handler("nope"),
      setup({ userId: "user-2" }).handler("t1"),
      setup({ actor: null }).handler("t1"),
    ]) {
      expect((await run).status).toBe(404);
    }
    const { handler, audits, deleted } = setup({ userId: null });
    expect((await handler("t1")).status).toBe(404);
    expect(audits).toEqual([]);
    expect(deleted).toEqual([]);
  });
});
