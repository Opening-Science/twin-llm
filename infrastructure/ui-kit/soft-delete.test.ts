import { describe, expect, test } from "bun:test";

import {
  createSoftDelete,
  guardsUnload,
  isSoftHidden,
  softDeleteReducer,
  type SoftDeletePhase,
} from "./soft-delete";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const harness = (result: () => Promise<string | null>) => {
  const seen: [SoftDeletePhase, string | null][] = [];
  const calls = { commit: 0 };
  const commit = () => {
    calls.commit += 1;
    return result();
  };
  const raw = createSoftDelete((phase, error) => seen.push([phase, error]));
  const item = {
    ...raw,
    expire: () => raw.expire(commit),
    leave: () => raw.leave(commit),
  };
  return { item, seen, calls };
};

describe("softDeleteReducer", () => {
  test("press, undo, expire and the answer move the phase in order only", () => {
    expect(softDeleteReducer("shown", "act")).toBe("pending");
    expect(softDeleteReducer("pending", "undo")).toBe("shown");
    expect(softDeleteReducer("pending", "expire")).toBe("deleting");
    expect(softDeleteReducer("deleting", "ok")).toBe("deleted");
    expect(softDeleteReducer("deleting", "fail")).toBe("failed");
    expect(softDeleteReducer("failed", "act")).toBe("pending");
    // Too late or too early: nothing changes.
    expect(softDeleteReducer("deleting", "undo")).toBe("deleting");
    expect(softDeleteReducer("shown", "expire")).toBe("shown");
    expect(softDeleteReducer("deleted", "act")).toBe("deleted");
  });

  test("hidden from the press until a failure; the tab guarded while unfinished", () => {
    expect(isSoftHidden("shown")).toBe(false);
    expect(isSoftHidden("pending")).toBe(true);
    expect(isSoftHidden("deleting")).toBe(true);
    expect(isSoftHidden("deleted")).toBe(true);
    expect(isSoftHidden("failed")).toBe(false);
    expect(guardsUnload("pending")).toBe(true);
    expect(guardsUnload("deleting")).toBe(true);
    expect(guardsUnload("deleted")).toBe(false);
    expect(guardsUnload("shown")).toBe(false);
  });
});

describe("createSoftDelete", () => {
  test("the press asks the server nothing; the delete runs once, at expiry", async () => {
    const { item, seen, calls } = harness(() => Promise.resolve(null));
    item.act();
    expect(calls.commit).toBe(0);
    expect(item.phase()).toBe("pending");
    item.expire();
    item.expire();
    item.leave();
    await settle();
    expect(calls.commit).toBe(1);
    expect(seen).toEqual([
      ["pending", null],
      ["deleting", null],
      ["deleted", null],
    ]);
  });

  test("Undo restores the item and the window ending later deletes nothing", async () => {
    const { item, calls } = harness(() => Promise.resolve(null));
    item.act();
    item.undo();
    item.expire();
    item.leave();
    await settle();
    expect(calls.commit).toBe(0);
    expect(item.phase()).toBe("shown");
  });

  test("leaving the page inside the window runs the delete then", async () => {
    const { item, calls } = harness(() => Promise.resolve(null));
    item.act();
    item.leave();
    await settle();
    expect(calls.commit).toBe(1);
    expect(item.phase()).toBe("deleted");
  });

  test("leaving without a press deletes nothing", async () => {
    const { item, calls } = harness(() => Promise.resolve(null));
    item.leave();
    await settle();
    expect(calls.commit).toBe(0);
  });

  test("a refused delete brings the item back with the reason, and can be tried again", async () => {
    const { item, seen, calls } = harness(() => Promise.resolve("Not found."));
    item.act();
    item.expire();
    await settle();
    expect(item.phase()).toBe("failed");
    expect(seen.at(-1)).toEqual(["failed", "Not found."]);
    item.act();
    expect(item.phase()).toBe("pending");
    item.expire();
    await settle();
    expect(calls.commit).toBe(2);
  });

  test("a network error reads as a plain sentence", async () => {
    const { item, seen } = harness(() => Promise.reject(new Error("socket hang up")));
    item.act();
    item.expire();
    await settle();
    expect(seen.at(-1)).toEqual(["failed", "The delete did not go through. Try again."]);
  });
});
